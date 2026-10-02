import { Component, type ReactNode } from 'react'
import { Button, Stack } from '@skyground-media/pipelean-design-system'

/**
 * A part of the app that fails to render shows what went wrong, with a way
 * to reload, instead of leaving the whole page blank.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="welcome-body">
        <Stack gap={4}>
          <div className="page-heading">
            <h1>Qualcosa non ha funzionato</h1>
            <p>Ricarica la pagina. Se succede ancora, manda questo messaggio a chi segue Spark:</p>
          </div>
          <pre className="error-detail">{this.state.error.message}</pre>
          <div>
            <Button onClick={() => window.location.reload()}>Ricarica</Button>
          </div>
        </Stack>
      </div>
    )
  }
}
