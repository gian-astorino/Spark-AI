// POST /functions/v1/logo  { business_id }   (service role only)
//
// Refreshes a business's logo in a request of its own: brand colours read
// from it, then a square high-resolution version (see _shared/logo.ts).
// Called by the other functions whenever a logo enters the profile; answers
// at once and works in the background.

import { createClient } from '@supabase/supabase-js'
import { refreshLogo } from '../_shared/logo.ts'

Deno.serve(async (request) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (request.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return new Response('Forbidden', { status: 403 })
  }
  const { business_id } = await request.json().catch(() => ({}))
  if (typeof business_id !== 'string') return new Response('business_id is required', { status: 400 })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
  EdgeRuntime.waitUntil(refreshLogo(db, business_id).catch((failure) => console.error(failure)))
  return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { 'Content-Type': 'application/json' } })
})
