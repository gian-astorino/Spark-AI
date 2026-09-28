import { createClient } from '@supabase/supabase-js'

// Both values are public by design: the publishable key only reaches what
// row level security lets the signed-in user reach.
const SUPABASE_URL = 'https://mdfobooelxewsoqqviez.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_KCRVfsn517h-o2L9s2XYug_I225SjsG'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)

/** Everyone gets a session straight away; an email can be attached later. */
export async function ensureSession() {
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session.user
  const { data: signedIn, error } = await supabase.auth.signInAnonymously()
  if (error || !signedIn.user) throw error ?? new Error('Could not start a session')
  return signedIn.user
}
