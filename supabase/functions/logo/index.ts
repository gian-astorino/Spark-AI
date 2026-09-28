// POST /functions/v1/logo  { business_id }   (internal: x-logo-token header)
//
// Refreshes a business's logo in a request of its own: brand colours read
// from it, then a square high-resolution version (see _shared/logo.ts).
// Called by the other functions whenever a logo enters the profile; answers
// at once and works in the background.

import { createClient } from '@supabase/supabase-js'
import { refreshLogo } from '../_shared/logo.ts'

Deno.serve(async (request) => {
  const token = Deno.env.get('LOGO_TRIGGER_TOKEN')
  if (!token || request.headers.get('x-logo-token') !== token) return new Response('Forbidden', { status: 403 })
  const { business_id } = await request.json().catch(() => ({}))
  if (typeof business_id !== 'string') return new Response('business_id is required', { status: 400 })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  EdgeRuntime.waitUntil(refreshLogo(db, business_id).catch((failure) => console.error(failure)))
  return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { 'Content-Type': 'application/json' } })
})
