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

// Every workspace has its own address, #/w/<id>: reloading or sharing it opens
// exactly that one. A hash, as GitHub Pages serves one page and nothing under it.
const WORKSPACE = /^#\/w\/([0-9a-f-]{36})$/i

const workspaceInAddress = () => WORKSPACE.exec(window.location.hash)?.[1] ?? null

/** The address for a view, without reloading or adding a step to the history when `replace`. */
function setAddress(hash: string, replace = false) {
  if (window.location.hash === hash || (!window.location.hash && hash === '#/')) return
  if (replace) window.history.replaceState(null, '', hash)
  else window.history.pushState(null, '', hash)
}

const signOut = () => {
  setAddress('#/', true)
  void supabase.auth.signOut()
}

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

  // Where a signed-in user lands: the workspace in the address, if they can
  // reach it; otherwise an admin on every workspace, and a user in their own
  // one, or in the onboarding that creates it.
  useEffect(() => {
    if (!userId || view.name !== 'loading') return
    let cancelled = false
    void (async () => {
      try {
        const role = await isAdmin()
        if (cancelled) return
        setAdmin(role)
        const reachable = await listWorkspaces()
        if (cancelled) return
        const asked = workspaceInAddress()
        if (asked && reachable.some((workspace) => workspace.id === asked)) {
          return setView({ name: 'open', workspaceId: asked })
        }
        if (role) {
          setAddress('#/', true)
          return setView({ name: 'workspaces' })
        }
        const [own] = reachable
        if (own) {
          setAddress(`#/w/${own.id}`, true)
          setView({ name: 'open', workspaceId: own.id })
        } else {
          setAddress('#/', true)
          setView({ name: 'source' })
        }
      } catch (error) {
        console.error(error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId, view.name])

  // Back and forward in the browser move between the list and the workspaces.
  useEffect(() => {
    const follow = () => {
      const asked = workspaceInAddress()
      if (asked) setView({ name: 'open', workspaceId: asked })
      else if (admin) setView({ name: 'workspaces' })
    }
    window.addEventListener('popstate', follow)
    return () => window.removeEventListener('popstate', follow)
  }, [admin])

  if (session === undefined) return null
  // The anonymous sessions of the first version count as signed out.
  if (!signedIn) return <Login />

  const open = (workspaceId: string) => {
    setAddress(`#/w/${workspaceId}`)
    setView({ name: 'open', workspaceId })
  }
  const toWorkspaces = admin
    ? () => {
        setAddress('#/')
        setView({ name: 'workspaces' })
      }
    : undefined
  const leave = admin ? undefined : signOut
  switch (view.name) {
    case 'loading':
      return null
    case 'workspaces':
      return (
        <Workspaces
          email={session.user.email}
          onOpen={(workspace) => open(workspace.id)}
          onCreate={() => setView({ name: 'source' })}
        />
      )
    case 'source':
      return <SourceStep onContinue={(request) => setView({ name: 'new', request })} onBack={toWorkspaces} />
    case 'new':
      return (
        <ChatStep
          request={view.request}
          onBack={toWorkspaces}
          onSignOut={leave}
          // The new workspace's address replaces the list's, so a reload reopens it.
          onCreated={(id) => setAddress(`#/w/${id}`, true)}
        />
      )
    case 'open':
      return <ChatStep key={view.workspaceId} workspaceId={view.workspaceId} onBack={toWorkspaces} onSignOut={leave} />
  }
}
