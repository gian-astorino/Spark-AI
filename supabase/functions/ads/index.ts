// POST /functions/v1/ads  { business_id }  moves the ad images still being made, { running }
//
// The app calls this every few seconds while an ad card waits for its image:
// each image is an OpenAI background job that only moves when someone looks
// (see _shared/ad-images.ts). The ads themselves the app reads directly.

import { createClient } from '@supabase/supabase-js'
import { checkAdImages } from '../_shared/ad-images.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { business_id } = await request.json().catch(() => ({}))
  if (typeof business_id !== 'string') return json({ error: 'business_id is required' }, 400)

  // Ownership is checked with the caller's own token: RLS answers for us.
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
  })
  const { data: owned } = await asUser.from('businesses').select('id').eq('id', business_id).maybeSingle()
  if (!owned) return json({ error: 'Business not found' }, 404)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    return json({ running: await checkAdImages(db, business_id) }, 200)
  } catch (failure) {
    console.error(failure)
    return json({ error: String(failure) }, 500)
  }
})

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
