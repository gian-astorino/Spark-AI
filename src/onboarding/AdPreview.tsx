import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Inline,
  ItemDescription,
  ItemTitle,
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
}

const GENDERS: Record<AdProposal['audience']['genders'], string> = {
  all: 'Tutti',
  women: 'Donne',
  men: 'Uomini',
}

const euro = (value: number) =>
  new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value)

/**
 * The first-ad proposal as the ad would look in a feed, then what it is made
 * of: the offer, the audience, the budget and the reasoning.
 */
export function AdPreview({
  proposal,
  creative,
  profile,
  onRegenerate,
  regenerating,
}: {
  proposal: AdProposal
  /** The generated image: undefined while it is being made, null if that failed. */
  creative?: string | null
  profile: Profile
  onRegenerate: () => void
  regenerating: boolean
}) {
  const name = profile.business?.name ?? 'La tua attività'
  const brand = profile.branding?.colors[0]?.hex
  const { treatment, offer, ad, visual, audience, budget } = proposal

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
            Until it arrives, the brand's colour (content, not our UI). */}
        {creative ? (
          <img className="ad-visual" src={creative} alt={visual.overlay_text} />
        ) : (
          <div
            className="ad-visual ad-visual-empty"
            style={{ background: brand ? `linear-gradient(135deg, ${brand}, color-mix(in oklch, ${brand} 55%, black))` : undefined }}
          >
            <span className="ad-visual-status">
              {creative === undefined ? "Sto creando l'inserzione…" : "Non sono riuscito a creare l'inserzione"}
            </span>
          </div>
        )}

        <footer className="ad-foot">
          <span>
            <strong>{ad.headline}</strong>
            <small>{ad.description}</small>
          </span>
          <Button variant="secondary" size="sm" tabIndex={-1}>
            {CTA_LABELS[ad.cta] ?? 'Scopri di più'}
          </Button>
        </footer>
      </article>

      <dl className="rows ad-facts">
        <Fact label="Trattamento" value={treatment.name} detail={treatment.why} />
        <Fact
          label="Offerta"
          value={`${euro(offer.discounted_price_eur)} invece di ${euro(treatment.list_price_eur)}`}
          detail={`${offer.conditions} · ${offer.duration_days} giorni`}
        />
        <Fact
          label="Pubblico"
          value={`${GENDERS[audience.genders]}, ${audience.age_min}–${audience.age_max} anni`}
          detail={`Entro ${audience.radius_km} km dalla sede${audience.interests.length ? ` · ${audience.interests.join(', ')}` : ''}`}
        />
        <Fact
          label="Budget di prova"
          value={`${euro(budget.total_eur)}`}
          detail={`${euro(budget.daily_eur)} al giorno per ${budget.days} giorni`}
        />
      </dl>

      <Stack gap={2}>
        <ItemTitle>Perché questa proposta</ItemTitle>
        <ItemDescription>{proposal.rationale}</ItemDescription>
        <ItemDescription>Visual: {visual.concept}</ItemDescription>
      </Stack>

      <Inline gap={2} align="center">
        <Button variant="outline" size="sm" onClick={onRegenerate} disabled={regenerating}>
          {regenerating ? 'Sto ripensando…' : 'Rigenera'}
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
