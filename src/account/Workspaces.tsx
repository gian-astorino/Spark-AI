import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Inline,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Skeleton,
  Stack,
} from '@skyground-media/pipelean-design-system'
import { ArrowRight01Icon, Logout03Icon, PlusSignIcon, Store04Icon } from '@hugeicons/core-free-icons'
import { supabase } from '../lib/supabase.ts'
import { listWorkspaces, type Workspace } from '../onboarding/backend.ts'
import { Icon } from '../onboarding/Icon.tsx'
import { SparkLogo } from '../onboarding/SparkLogo.tsx'

const updated = (iso: string) =>
  new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })

/** For admins: every workspace, with its owner. Open one, or start a new one. */
export function Workspaces({
  email,
  onOpen,
  onCreate,
}: {
  email?: string
  onOpen: (workspace: Workspace) => void
  onCreate: () => void
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    listWorkspaces(true).then(setWorkspaces, (error) => {
      console.error(error)
      setFailed(true)
    })
  }, [])

  return (
    <div className="welcome">
      <div className="welcome-aside">
        <SparkLogo />
      </div>
      <div className="welcome-body">
        <Stack gap={8}>
          <Stack gap={2}>
            <div className="page-heading">
              <h1>Workspace</h1>
              <p>Tutti i workspace, uno per attività: come admin li vedi e li gestisci tutti.</p>
            </div>
          </Stack>

          {workspaces === null && !failed ? (
            <Stack gap={2}>
              <Skeleton width="full" />
              <Skeleton width="full" />
            </Stack>
          ) : failed ? (
            <p className="form-notice">Non riesco a caricare i workspace. Ricarica la pagina.</p>
          ) : workspaces && workspaces.length > 0 ? (
            <Stack gap={2}>
              {workspaces.map((workspace) => (
                <Item key={workspace.id} variant="outline" asChild>
                  <button type="button" className="workspace-row" onClick={() => onOpen(workspace)}>
                    <ItemMedia variant="icon">
                      <Icon icon={Store04Icon} />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {workspace.name ?? 'Attività senza nome'}
                        {!workspace.completed && <Badge variant="secondary">Onboarding in corso</Badge>}
                      </ItemTitle>
                      <ItemDescription>
                        {[workspace.ownerEmail ?? 'Account anonimo', workspace.sector, `Aggiornato il ${updated(workspace.updatedAt)}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Icon icon={ArrowRight01Icon} />
                    </ItemActions>
                  </button>
                </Item>
              ))}
            </Stack>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Ancora nessun workspace</EmptyTitle>
                <EmptyDescription>Crea il primo: Spark raccoglie il contesto della tua attività.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          <div className="stretch">
            <Button size="lg" onClick={onCreate}>
              <Icon icon={PlusSignIcon} />
              Nuovo workspace
            </Button>
          </div>

          <Inline gap={2} align="center" justify="between">
            <span className="account-email">{email}</span>
            <Button variant="ghost" size="sm" onClick={() => void supabase.auth.signOut()}>
              <Icon icon={Logout03Icon} />
              Esci
            </Button>
          </Inline>
        </Stack>
      </div>
    </div>
  )
}
