import { useState } from 'react'
import {
  Button,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Stack,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@skyground-media/pipelean-design-system'
import { supabase } from '../lib/supabase.ts'
import { SparkLogo } from '../onboarding/SparkLogo.tsx'

type Mode = 'signin' | 'signup'

/** Supabase's English errors, in the owner's words. */
function italian(message: string) {
  if (/invalid login credentials/i.test(message)) return 'Email o password non corretti.'
  if (/email not confirmed/i.test(message)) return "Conferma prima l'email: ti abbiamo mandato un link."
  if (/already registered|already exists/i.test(message)) return 'Esiste già un account con questa email: accedi.'
  if (/password should be at least/i.test(message)) return 'La password deve avere almeno 6 caratteri.'
  if (/rate limit/i.test(message)) return 'Troppi tentativi: riprova tra qualche minuto.'
  return 'Qualcosa è andato storto. Riprova.'
}

/** Sign in, or create the account: Spark keeps every workspace under it. */
export function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'signin') {
        const { error: failure } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (failure) setError(italian(failure.message))
      } else {
        const { data, error: failure } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
        })
        if (failure) setError(italian(failure.message))
        // With email confirmation on, there is no session until the link is opened.
        else if (!data.session) setNotice("Ti abbiamo mandato un'email: apri il link per confermare l'account, poi accedi.")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-aside">
        <SparkLogo />
      </div>
      <form className="welcome-body" onSubmit={submit}>
        <Stack gap={8}>
          <div className="page-heading">
            <h1>{mode === 'signin' ? 'Accedi' : 'Crea il tuo account'}</h1>
            <p>Ritrovi qui tutti i tuoi workspace.</p>
          </div>

          <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
            <TabsList>
              <TabsTrigger value="signin">Accedi</TabsTrigger>
              <TabsTrigger value="signup">Crea account</TabsTrigger>
            </TabsList>
          </Tabs>

          <Stack gap={4}>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={6}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {error && <FieldError>{error}</FieldError>}
            </Field>
            {notice && <p className="form-notice">{notice}</p>}
          </Stack>

          <div className="stretch welcome-action">
            <Button type="submit" size="lg" disabled={busy}>
              {mode === 'signin' ? 'Accedi' : 'Crea account'}
            </Button>
          </div>
        </Stack>
      </form>
    </div>
  )
}
