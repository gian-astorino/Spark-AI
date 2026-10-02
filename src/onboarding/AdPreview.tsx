import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Inline,
  Stack,
} from '@skyground-media/pipelean-design-system'
import type { AdProposal } from './backend.ts'
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

const euro = (value: number) =>
  new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value)

/** Where the ad's image stands: it is made only once the owner approves the campaign. */
export type CreativeState = 'idle' | 'making' | 'done' | 'failed'

/**
 * The first campaign: the ad as it would look in a feed, then the
 * strategist's six decisions (product, offer, target, problem, angle, CPL).
 */
export function AdPreview({
  proposal,
  creative,
  creativeState,
  profile,
  onApprove,
  onRegenerate,
  regenerating,
}: {
  proposal: AdProposal
  /** The generated image, once made. */
  creative?: string | null
  creativeState: CreativeState
  profile: Profile
  /** The owner approves the campaign: its image is made then. */
  onApprove: () => void
  onRegenerate: () => void
  regenerating: boolean
}) {
  const name = profile.business?.name ?? 'La tua attività'
  const brand = profile.branding?.colors[0]?.hex
  const { campaign, creative: plan, ad } = proposal

  return (
    <Stack gap={4}>
      <article className="ad-card" aria-label="Anteprima dell'inserzione">
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

        <p className="ad-text">{ad.primary_text}</p>

        {/* The ad image is the ad: its text is written by the image model, nothing is laid over it.
            Until it is made, the brand's colour (content, not our UI) and the copy it will carry. */}
        {creative ? (
          <img className="ad-visual" src={creative} alt={plan.copy_on_image} />
        ) : (
          <div
            className="ad-visual ad-visual-empty"
            style={{ background: brand ? `linear-gradient(135deg, ${brand}, color-mix(in oklch, ${brand} 55%, black))` : undefined }}
          >
            <span className="ad-visual-status">
              {creativeState === 'making'
                ? "Sto creando l'immagine…"
                : creativeState === 'failed'
                  ? "Non sono riuscito a creare l'immagine"
                  : "L'immagine si crea dopo la tua approvazione"}
            </span>
          </div>
        )}

        <footer className="ad-foot">
          <span>
            <strong>{ad.headline}</strong>
          </span>
          <Button variant="secondary" size="sm" tabIndex={-1}>
            {CTA_LABELS[ad.cta] ?? 'Scopri di più'}
          </Button>
        </footer>
      </article>

      <Inline gap={2} align="center">
        <Badge variant="secondary">{proposal.awareness}</Badge>
        <Badge variant="secondary">{plan.format}</Badge>
      </Inline>

      <dl className="rows ad-facts">
        <Fact label="Prodotto o servizio" value={campaign.product} />
        <Fact
          label="Offerta"
          value={campaign.offer}
          detail={[
            campaign.offer_price_eur != null && (campaign.offer_price_eur === 0 ? 'Gratis' : euro(campaign.offer_price_eur)),
            proposal.item?.list_price_eur != null && `listino ${euro(proposal.item.list_price_eur)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
        <Fact label="Target" value={campaign.target} />
        <Fact label="Problema o desiderio" value={campaign.problem} />
        <Fact label="Angolo" value={campaign.angle} />
        <Fact label="CPL medio stimato" value={euro(proposal.cpl.estimate_eur)} detail={proposal.cpl.reasoning} />
      </dl>

      <Inline gap={2} align="center">
        {creativeState === 'idle' || creativeState === 'failed' ? (
          <Button size="sm" onClick={onApprove} disabled={regenerating}>
            {creativeState === 'failed' ? "Riprova a creare l'immagine" : "Approva e crea l'immagine"}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onRegenerate} disabled={regenerating || creativeState === 'making'}>
          {regenerating ? 'Sto ripensando…' : 'Rigenera la campagna'}
        </Button>
        <Badge variant="secondary">Bozza: non viene pubblicata</Badge>
      </Inline>
    </Stack>
  )
}

function Fact({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="row">
      <dt>
        {label}
        {detail && <small>{detail}</small>}
      </dt>
      <dd>{value}</dd>
    </div>
  )
}
