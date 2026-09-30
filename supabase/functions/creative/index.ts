// POST /functions/v1/creative  { proposal_id }          starts the image, { status }
// POST /functions/v1/creative  { proposal_id, check }   reports it, { status, url? }
//
// The image runs as an OpenAI background job (see _shared/image-jobs.ts): the
// app calls "check" every few seconds until it is done.
//
// The image of an ad proposal, generated with the business's logo given to
// the model as a reference image next to the prompt: the logo shapes the
// palette and style of the scene, and may appear in it naturally. The offer
// and prices are laid over it by the app, where they are always spelled right.
// Answers { url }.

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

    const [{ data: business }, { data: colors }, { data: brand }] = await Promise.all([
      db.from('businesses').select('name, sector').eq('id', proposal.business_id).single(),
      db.from('brand_colors').select('name, hex').eq('business_id', proposal.business_id).order('position'),
      db.from('brand_profiles').select('tone_description, logo_path').eq('business_id', proposal.business_id).maybeSingle(),
    ])
    // The logo as a reference image: raster only (the image model takes no SVG).
    let logo: string | null = null
    if (brand?.logo_path && !brand.logo_path.endsWith('.svg')) {
      const { data } = await db.storage.from('logos').download(brand.logo_path)
      if (data) logo = dataUrl(data.type || 'image/png', new Uint8Array(await data.arrayBuffer()))
    }
    const content = proposal.content as {
      treatment: { name: string; category?: string }
      visual: { concept: string }
    }
    const palette = (colors ?? []).map((color) => `${color.name} ${color.hex}`).join(', ')

    const prompt = [
      `A square advertising photograph for a ${business?.sector ?? 'beauty centre'} in Italy, promoting the treatment "${content.treatment.name}"${content.treatment.category ? ` (${content.treatment.category})` : ''}.`,
      `Art direction: ${content.visual.concept}`,
      palette ? `Colour palette taken from the brand: ${palette}. Let these colours lead the set, props, light and styling.` : '',
      logo
        ? `The attached image is the business's logo (${business?.name ?? 'the brand'}). Let it shape the look: its colours, its lines and its elegance. You may show it naturally in the scene, exactly as it is, on a product, a card, a towel or a sign; never redraw or alter it.`
        : '',
      brand?.tone_description ? `The brand's personality: ${brand.tone_description}` : '',
      'Editorial, natural and premium: soft light, real textures, a calm clean composition, photographed rather than illustrated.',
      'Leave the upper third calm and uncluttered, for a headline laid over it later.',
      logo
        ? 'Apart from the logo itself, no text, letters, numbers or watermarks anywhere in the image.'
        : 'No text, letters, numbers, logos or watermarks anywhere in the image.',
      'No before-and-after, no bodies presented as needing correction, no medical procedures or needles.',
    ]
      .filter(Boolean)
      .join('\n')

    const jobId = await startImageJob({ prompt, images: logo ? [logo] : [], action: logo ? 'edit' : 'generate' })
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

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
