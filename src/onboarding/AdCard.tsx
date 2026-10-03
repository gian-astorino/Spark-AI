import { Avatar, AvatarFallback, Badge, Button, Inline, Spinner, Stack } from '@skyground-media/pipelean-design-system'
import type { Ad } from './backend.ts'
import type { Profile } from './profile.ts'

const CTA_LABELS: Record<string, string> = {
  BOOK_NOW: 'Prenota ora',
  LEARN_MORE: 'Scopri di più',
  SEND_MESSAGE: 'Invia messaggio',
  CALL_NOW: 'Chiama ora',
  GET_OFFER: "Ottieni l'offerta",
  SIGN_UP: 'Iscriviti',
  SHOP_NOW: 'Acquista ora',
  CONTACT_US: 'Contattaci',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Bozza: non viene pubblicata',
  approved: 'Approvata',
  archived: 'Archiviata',
}

/**
 * An ad as the agent saved it: as it would look in a feed, then the
 * decisions behind it, whatever the agent chose to write down. Its actions
 * are things to ask Spark, sent as the owner's message.
 */
export function AdCard({ ad, profile, onAsk, busy }: { ad: Ad; profile: Profile; onAsk: (text: string) => void; busy: boolean }) {
  const name = profile.business?.name ?? 'La tua attività'
  const brand = profile.branding?.colors[0]?.hex
  const { copy, creative, strategy = [], objective } = ad.content
  const latest = ad.images[ad.images.length - 1]
  const shown = [...ad.images].reverse().find((image) => image.status === 'done' && image.url)
  const making = latest?.status === 'running'

  return (
    <Stack gap={4}>
      <article className="ad-card" aria-label={`Anteprima dell'inserzione ${ad.name}`}>
        <header className="ad-head">
          {profile.branding?.logoUrl && !profile.branding.logoPending ? (
            <img className="ad-logo" src={profile.branding.logoUrl} alt="" />
          ) : (
            <Avatar>
              <AvatarFallback>{name[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
          )}
          <span>
            <strong>{name}</strong>
            <small>Sponsorizzato</small>
          </span>
        </header>

        {copy?.primary_text && <p className="ad-text">{copy.primary_text}</p>}

        {/* The image is the ad: its text is written by the image model, nothing is laid over it.
            Until there is one, the brand's colour (content, not our UI) and where it stands. */}
        {shown && !making ? (
          <img className="ad-visual" src={shown.url} alt={creative?.text_on_image ?? ad.name} />
        ) : (
          <div
            className="ad-visual ad-visual-empty"
            style={{ background: brand ? `linear-gradient(135deg, ${brand}, color-mix(in oklch, ${brand} 55%, black))` : undefined }}
          >
            <span className="ad-visual-status">
              {making ? (
                <Inline gap={2} align="center">
                  <Spinner />
                  Sto creando l'immagine…
                </Inline>
              ) : latest?.status === 'failed' ? (
                "Non sono riuscito a creare l'immagine"
              ) : (
                'Ancora nessuna immagine'
              )}
            </span>
          </div>
        )}

        <footer className="ad-foot">
          <span>
            <strong>{copy?.headline ?? ad.name}</strong>
            {copy?.description && <small>{copy.description}</small>}
          </span>
          <Button variant="secondary" size="sm" tabIndex={-1}>
            {CTA_LABELS[copy?.cta ?? ''] ?? 'Scopri di più'}
          </Button>
        </footer>
      </article>

      <Inline gap={2} align="center">
        <Badge variant="secondary">{STATUS_LABELS[ad.status] ?? ad.status}</Badge>
        {creative?.format && <Badge variant="secondary">{creative.format}</Badge>}
        {ad.images.length > 1 && <Badge variant="secondary">{ad.images.length} versioni</Badge>}
      </Inline>

      {(objective || strategy.length > 0) && (
        <dl className="rows ad-facts">
          {objective && <Fact label="Obiettivo" value={objective} />}
          {strategy.map((fact) => (
            <Fact key={fact.label} label={fact.label} value={fact.text} />
          ))}
        </dl>
      )}

      <Inline gap={2} align="center">
        {!shown && !making && (
          <Button size="sm" disabled={busy} onClick={() => onAsk(`Mi piace «${ad.name}»: crea l'immagine.`)}>
            {latest?.status === 'failed' ? "Riprova a creare l'immagine" : "Approva e crea l'immagine"}
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onAsk(`Proponimi un'alternativa a «${ad.name}».`)}>
          Proponi un'alternativa
        </Button>
      </Inline>
    </Stack>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
