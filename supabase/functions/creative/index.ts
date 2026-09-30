// POST /functions/v1/creative  { proposal_id }          starts the image, { status }
// POST /functions/v1/creative  { proposal_id, check }   reports it, { status, url? }
//
// The image runs as an OpenAI background job (see _shared/image-jobs.ts): the
// app calls "check" every few seconds until it is done.
//
// The ad itself, made by gpt-image-2.5: the offer the proposal settled on and
// the brand board (logo, colours, fonts, pattern) as the reference image. The
// model writes all the ad's text; the app lays nothing over it.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkImageJob, dataUrl, startImageJob } from '../_shared/image-jobs.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { proposal_id, check } = await request.json().catch(() => ({}))
  if (typeof proposal_id !== 'string') return json({ error: 'proposal_id is required' }, 400)

  // The proposal is read with the caller's own token: RLS answers for ownership.
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
  })
  const { data: proposal } = await asUser
    .from('ad_proposals')
    .select('id, business_id, content, creative_job_id, creative_status, creative_path, creative_error')
    .eq('id', proposal_id)
    .maybeSingle()
  if (!proposal) return json({ error: 'Proposal not found' }, 404)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    if (check) return json(await report(db, proposal), 200)
    if (proposal.creative_status === 'running') return json({ status: 'running' }, 200)

    const [{ data: business }, { data: brand }] = await Promise.all([
      db.from('businesses').select('name, sector').eq('id', proposal.business_id).single(),
      db.from('brand_profiles').select('logo_path, board_path').eq('business_id', proposal.business_id).maybeSingle(),
    ])
    // The brand board as the reference; the logo if there is no board yet. Raster only (no SVG).
    const reference = [brand?.board_path, brand?.logo_path].find((path) => path && !path.endsWith('.svg'))
    let image: string | null = null
    if (reference) {
      const { data } = await db.storage.from('logos').download(reference)
      if (data) image = dataUrl(data.type || 'image/png', new Uint8Array(await data.arrayBuffer()))
    }
    const { treatment, offer, ad, visual } = proposal.content as {
      treatment: { name: string; list_price_eur: number }
      offer: { discount_percent: number; discounted_price_eur: number; conditions: string; duration_days: number }
      ad: { headline: string; cta: string }
      visual: { concept: string; overlay_text: string }
    }

    const prompt = [
      `Create a simple, clean square ad for Instagram and Facebook for ${business?.name ?? 'a business'}, a ${business?.sector || 'beauty'} business in Italy.`,
      image && reference === brand?.board_path
        ? "The attached image is the brand board: use its logo exactly as it is, its colours, its fonts and its pattern, so the ad is unmistakably this brand's. Do not copy the board's layout, swatches or labels."
        : image
          ? "The attached image is the business's logo: show it exactly as it is, and take the ad's colours from it."
          : '',
      `The offer: "${treatment.name}" at ${euro(offer.discounted_price_eur)} instead of ${euro(treatment.list_price_eur)} (-${offer.discount_percent}%), ${offer.conditions}, for ${offer.duration_days} days.`,
      `Write on the ad, in Italian, spelled exactly like this: the headline "${visual.overlay_text || ad.headline}", the treatment "${treatment.name}", the old price "${euro(treatment.list_price_eur)}" struck through next to the new price "${euro(offer.discounted_price_eur)}", the badge "-${offer.discount_percent}%" and a button "${CTA_LABELS[ad.cta] ?? 'Prenota ora'}". No other text.`,
      `Art direction: ${visual.concept}`,
      'Keep it simple: one clear idea, a strong hierarchy (headline, then the price), generous space, sharp and legible type in the brand fonts, premium and uncluttered.',
      'No before-and-after, no bodies presented as needing correction, no medical procedures or needles.',
    ]
      .filter(Boolean)
      .join('\n')

    const jobId = await startImageJob({ prompt, images: image ? [image] : [], action: image ? 'edit' : 'generate', size: '2048x2048' })
    await db
      .from('ad_proposals')
      .update({ creative_job_id: jobId, creative_status: 'running', creative_error: null })
      .eq('id', proposal.id)
    return json({ status: 'running' }, 200)
  } catch (failure) {
    console.error(failure)
    // Kept on the proposal, so a start that failed can be told from one that never came.
    if (!check) {
      await db
        .from('ad_proposals')
        .update({ creative_status: 'failed', creative_error: `start: ${String(failure)}`.slice(0, 2000) })
        .eq('id', proposal.id)
    }
    return json({ error: String(failure) }, 500)
  }
})

interface Proposal {
  id: string
  business_id: string
  creative_job_id: string | null
  creative_status: string | null
  creative_path: string | null
  creative_error: string | null
}

/** Where the image stands; once the job is done, stores it and returns its address. */
async function report(db: SupabaseClient, proposal: Proposal) {
  if (proposal.creative_path) return { status: 'done', url: await signed(db, proposal.creative_path) }
  if (proposal.creative_status === 'failed') return { status: 'failed', error: proposal.creative_error }
  if (!proposal.creative_job_id) return { status: 'none' }

  const state = await checkImageJob(proposal.creative_job_id)
  if (state.status === 'running') return { status: 'running' }
  if (state.status === 'failed') {
    await db.from('ad_proposals').update({ creative_status: 'failed', creative_error: state.error }).eq('id', proposal.id)
    return { status: 'failed', error: state.error }
  }
  const path = `${proposal.business_id}/${proposal.id}.png`
  const { error } = await db.storage.from('creatives').upload(path, state.png, { contentType: 'image/png', upsert: true })
  if (error) throw error
  await db.from('ad_proposals').update({ creative_path: path, creative_status: 'done' }).eq('id', proposal.id)
  return { status: 'done', url: await signed(db, path) }
}

async function signed(db: SupabaseClient, path: string) {
  const { data } = await db.storage.from('creatives').createSignedUrl(path, 60 * 60)
  return data?.signedUrl
}

const CTA_LABELS: Record<string, string> = {
  BOOK_NOW: 'Prenota ora',
  LEARN_MORE: 'Scopri di più',
  SEND_MESSAGE: 'Scrivici',
  CALL_NOW: 'Chiamaci',
  GET_OFFER: "Ottieni l'offerta",
}

/** 49 → "49 €", 48.5 → "48,50 €", as an Italian would write it. */
function euro(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace('.', ',')} €`
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
