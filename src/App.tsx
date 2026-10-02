import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Login } from './account/Login.tsx'
import { Workspaces } from './account/Workspaces.tsx'
import { supabase } from './lib/supabase.ts'
import { isAdmin, listWorkspaces } from './onboarding/backend.ts'
import { ChatStep } from './onboarding/ChatStep.tsx'
import { SourceStep } from './onboarding/SourceStep.tsx'
import type { ImportRequest } from './onboarding/types.ts'

type View =
  | { name: 'loading' }
  | { name: 'workspaces' }
  | { name: 'source' }
  | { name: 'new'; request: ImportRequest }
  | { name: 'open'; workspaceId: string }

const signOut = () => void supabase.auth.signOut()

export default function App() {
  // undefined until the stored session is read.
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [admin, setAdmin] = useState(false)
  const [view, setView] = useState<View>({ name: 'loading' })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      // A token refresh keeps the owner where they are; signing in or out starts over.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setView({ name: 'loading' })
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const signedIn = !!session && !session.user.is_anonymous
  const userId = signedIn ? session.user.id : null

  // Where a signed-in user lands: an admin on every workspace; a user in their
  // own workspace, or in the onboarding that creates it.
  useEffect(() => {
    if (!userId || view.name !== 'loading') return
    let cancelled = false
    void (async () => {
      try {
        const role = await isAdmin()
        if (cancelled) return
        setAdmin(role)
        if (role) return setView({ name: 'workspaces' })
        const [own] = await listWorkspaces()
        if (!cancelled) setView(own ? { name: 'open', workspaceId: own.id } : { name: 'source' })
      } catch (error) {
        console.error(error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId, view.name])

  if (session === undefined) return null
  // The anonymous sessions of the first version count as signed out.
  if (!signedIn) return <Login />

  const toWorkspaces = admin ? () => setView({ name: 'workspaces' }) : undefined
  const leave = admin ? undefined : signOut
  switch (view.name) {
    case 'loading':
      return null
    case 'workspaces':
      return (
        <Workspaces
          email={session.user.email}
          onOpen={(workspace) => setView({ name: 'open', workspaceId: workspace.id })}
          onCreate={() => setView({ name: 'source' })}
        />
      )
    case 'source':
      return <SourceStep onContinue={(request) => setView({ name: 'new', request })} onBack={toWorkspaces} />
    case 'new':
      return <ChatStep request={view.request} onBack={toWorkspaces} onSignOut={leave} />
    case 'open':
      return <ChatStep key={view.workspaceId} workspaceId={view.workspaceId} onBack={toWorkspaces} onSignOut={leave} />
  }
}
