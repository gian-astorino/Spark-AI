// POST /functions/v1/creative  { proposal_id }
//
// The image of an ad proposal, generated with the business's logo given to
// the model as a reference image next to the prompt: the logo shapes the
// palette and style of the scene, and may appear in it naturally. The offer
// and prices are laid over it by the app, where they are always spelled right.
// Answers { url }.

import OpenAI, { toFile } from 'openai'
import { createClient } from '@supabase/supabase-js'

const IMAGE_MODEL = 'gpt-image-2.5-sunburst'
const openai = new OpenAI() // OPENAI_API_KEY from the function's secrets

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { proposal_id } = await request.json().catch(() => ({}))
  if (typeof proposal_id !== 'string') return json({ error: 'proposal_id is required' }, 400)

  // The proposal is read with the caller's own token: RLS answers for ownership.
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
  })
  const { data: proposal } = await asUser
    .from('ad_proposals')
    .select('id, business_id, content')
    .eq('id', proposal_id)
    .maybeSingle()
  if (!proposal) return json({ error: 'Proposal not found' }, 404)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const [{ data: business }, { data: colors }, { data: brand }] = await Promise.all([
      db.from('businesses').select('name, sector').eq('id', proposal.business_id).single(),
      db.from('brand_colors').select('name, hex').eq('business_id', proposal.business_id).order('position'),
      db.from('brand_profiles').select('tone_description, logo_path').eq('business_id', proposal.business_id).maybeSingle(),
    ])
    // The logo as a reference image: raster only (the image model takes no SVG).
    let logo: Blob | null = null
    if (brand?.logo_path && !brand.logo_path.endsWith('.svg')) {
      const { data } = await db.storage.from('logos').download(brand.logo_path)
      logo = data ?? null
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

    const settings = { model: IMAGE_MODEL, prompt, size: '1024x1024', quality: 'high', output_format: 'png' } as const
    const image = logo
      ? await openai.images.edit({ ...settings, image: await toFile(logo, 'logo.png', { type: logo.type }) })
      : await openai.images.generate(settings)
    const b64 = image.data?.[0]?.b64_json
    if (!b64) throw new Error('The image model returned no image')

    const path = `${proposal.business_id}/${proposal.id}.png`
    const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0))
    const { error } = await db.storage.from('creatives').upload(path, bytes, { contentType: 'image/png', upsert: true })
    if (error) throw error
    await db.from('ad_proposals').update({ creative_path: path }).eq('id', proposal.id)

    const { data: signed } = await db.storage.from('creatives').createSignedUrl(path, 60 * 60)
    return json({ url: signed?.signedUrl }, 200)
  } catch (failure) {
    console.error(failure)
    return json({ error: String(failure) }, 500)
  }
})

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
