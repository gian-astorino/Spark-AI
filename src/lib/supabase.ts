import { createClient } from '@supabase/supabase-js'

// Both values are public by design: the publishable key only reaches what
// row level security lets the signed-in user reach.
const SUPABASE_URL = 'https://mdfobooelxewsoqqviez.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_KCRVfsn517h-o2L9s2XYug_I225SjsG'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)

/** The signed-in user: Spark is used with an account, every workspace belongs to one. */
export async function currentUser() {
  const { data } = await supabase.auth.getSession()
  if (!data.session || data.session.user.is_anonymous) throw new Error('Not signed in')
  return data.session.user
}
