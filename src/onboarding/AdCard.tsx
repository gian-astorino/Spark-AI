import { Avatar, AvatarFallback, Button } from '@skyground-media/pipelean-design-system'
// Inline, so its strokes take the container's colour (currentColor) and its animations run.
import imagining from './imagining.svg?raw'
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

/** An ad as it would look in a feed: the post only, the strategy is in Spark's reply. */
export function AdCard({ ad, profile }: { ad: Ad; profile: Profile }) {
  const name = profile.business?.name ?? 'La tua attività'
  const brand = profile.branding?.colors[0]?.hex
  const { copy, creative } = ad.content
  const latest = ad.images[ad.images.length - 1]
  const shown = [...ad.images].reverse().find((image) => image.status === 'done' && image.url)
  const making = latest?.status === 'running'

  return (
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
          {making ? (
            <span className="imagining" role="img" aria-label="Sto creando l'immagine" dangerouslySetInnerHTML={{ __html: imagining }} />
          ) : (
            <span className="ad-visual-status">
              {latest?.status === 'failed' ? "Non sono riuscito a creare l'immagine" : 'Ancora nessuna immagine'}
            </span>
          )}
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
  )
}
