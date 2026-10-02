import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Login } from './account/Login.tsx'
import { Workspaces } from './account/Workspaces.tsx'
import { supabase } from './lib/supabase.ts'
import { ChatStep } from './onboarding/ChatStep.tsx'
import { SourceStep } from './onboarding/SourceStep.tsx'
import type { ImportRequest } from './onboarding/types.ts'

type View =
  | { name: 'workspaces' }
  | { name: 'source' }
  | { name: 'new'; request: ImportRequest }
  | { name: 'open'; workspaceId: string }

export default function App() {
  // undefined until the stored session is read.
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [view, setView] = useState<View>({ name: 'workspaces' })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      // A token refresh keeps the owner where they are; signing in or out starts over.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setView({ name: 'workspaces' })
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return null
  // The anonymous sessions of the first version count as signed out.
  if (!session || session.user.is_anonymous) return <Login />

  const toWorkspaces = () => setView({ name: 'workspaces' })
  switch (view.name) {
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
      return <ChatStep request={view.request} onBack={toWorkspaces} />
    case 'open':
      return <ChatStep key={view.workspaceId} workspaceId={view.workspaceId} onBack={toWorkspaces} />
  }
}
