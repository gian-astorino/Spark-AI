// POST /functions/v1/logo
//
//   { business_id }          (internal, x-logo-token header) refreshes the logo:
//                            colours now, the recreation as a background job.
//   { business_id, board }   (internal) a new brand board only, logo untouched.
//   { business_id, check }   (the owner's session) reports the recreation and,
//                            once it is done, keeps it or not. The app calls
//                            this every few seconds while it runs.
//
// See _shared/logo.ts. The platform's JWT check is off for this function: the
// internal call carries a token of its own, the check is verified here.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkBoard, checkLogo, refreshBoard, refreshLogo } from '../_shared/logo.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { business_id, check, board } = await request.json().catch(() => ({}))
  if (typeof business_id !== 'string') return json({ error: 'business_id is required' }, 400)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const token = Deno.env.get('LOGO_TRIGGER_TOKEN')
  const internal = !!token && request.headers.get('x-logo-token') === token

  if (check) {
    if (internal) return json(await checkBoth(db, business_id), 200)
    // The owner's own token: RLS answers whether the business is theirs.
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
    })
    const { data: owned } = await asUser.from('businesses').select('id').eq('id', business_id).maybeSingle()
    if (!owned) return json({ error: 'Business not found' }, 404)
    try {
      return json(await checkBoth(db, business_id), 200)
    } catch (failure) {
      console.error(failure)
      return json({ error: String(failure) }, 500)
    }
  }

  if (!internal) return json({ error: 'Forbidden' }, 403)
  // { business_id, board: true }: a new brand board only, from the current logo and palette.
  if (board) {
    try {
      await refreshBoard(db, business_id)
      return json({ board: 'running' }, 202)
    } catch (failure) {
      return json({ error: String(failure) }, 400)
    }
  }
  // Starts the recreation, then follows it for as long as this function may
  // run; if the image takes longer, the agent's turns and the app move it on.
  EdgeRuntime.waitUntil(
    (async () => {
      await refreshLogo(db, business_id)
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10_000))
        const { status, board } = await checkBoth(db, business_id)
        if (status !== 'running' && board !== 'running') return
      }
    })().catch((failure) => console.error(failure)),
  )
  return json({ ok: true }, 202)
})

/** The logo's recreation and the brand board, both moved on. */
async function checkBoth(db: SupabaseClient, businessId: string) {
  const [status, board] = await Promise.all([checkLogo(db, businessId), checkBoard(db, businessId)])
  return { status, board }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
