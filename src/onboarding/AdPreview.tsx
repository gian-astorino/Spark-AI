import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
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
  SIGN_UP: 'Iscriviti',
  SHOP_NOW: 'Acquista ora',
  CONTACT_US: 'Contattaci',
}

const GENDERS: Record<AdProposal['audience']['genders'], string> = {
  all: 'Tutti',
  women: 'Donne',
  men: 'Uomini',
}

const CONFIDENCE: Record<AdProposal['confidence']['level'], string> = {
  HIGH: 'Confidence alta',
  MEDIUM: 'Confidence media',
  LOW: 'Confidence bassa',
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
 * The first campaign: the ad as it would look in a feed, the campaign's
 * essentials, then the strategy behind it, section by section.
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
  const { campaign, creative: plan, audience, budget, ad } = proposal

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
            <small>{ad.description}</small>
          </span>
          <Button variant="secondary" size="sm" tabIndex={-1}>
            {CTA_LABELS[ad.cta] ?? campaign.cta}
          </Button>
        </footer>
      </article>

      <Inline gap={2} align="center">
        <Badge variant="secondary">{CONFIDENCE[proposal.confidence.level]}</Badge>
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
        <Fact
          label="Pubblico Meta"
          value={`${GENDERS[audience.genders]}, ${audience.age_min}–${audience.age_max} anni`}
          detail={[audience.radius_km != null ? `entro ${audience.radius_km} km` : audience.area, audience.interests.join(', ')]
            .filter(Boolean)
            .join(' · ')}
        />
        <Fact label="Problema o desiderio" value={campaign.problem} />
        <Fact label="Angolo" value={campaign.angle} />
        <Fact label="Big idea" value={campaign.big_idea} />
        <Fact label="Promessa" value={campaign.promise} />
        <Fact label="Funnel" value={proposal.funnel} />
        <Fact
          label="Budget di test"
          value={euro(budget.total_eur)}
          detail={`${euro(budget.daily_eur)} al giorno per ${budget.days} giorni`}
        />
      </dl>

      <Accordion type="multiple">
        <AccordionItem value="why">
          <AccordionTrigger>Perché questa campagna</AccordionTrigger>
          <AccordionContent>
            <Stack gap={2}>
              <ItemDescription>{proposal.why}</ItemDescription>
              <ItemDescription>{proposal.confidence.reason}</ItemDescription>
            </Stack>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="creative">
          <AccordionTrigger>Creatività</AccordionTrigger>
          <AccordionContent>
            <dl className="rows">
              <Fact label="Hero visual" value={plan.hero_visual} />
              <Fact label="Gerarchia visiva" value={plan.hierarchy} />
              <Fact label="Copy on image" value={plan.copy_on_image} />
            </dl>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="concepts">
          <AccordionTrigger>3 concept statici</AccordionTrigger>
          <AccordionContent>
            <Stack gap={4}>
              {proposal.concepts.map((concept, index) => (
                <Stack key={index} gap={1}>
                  <ItemTitle>
                    {index + 1}. {concept.concept}
                  </ItemTitle>
                  <ItemDescription>
                    <strong>{concept.headline}</strong> — {concept.copy}
                  </ItemDescription>
                  <ItemDescription>
                    Visual: {concept.visual} · CTA: {concept.cta}
                  </ItemDescription>
                </Stack>
              ))}
            </Stack>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="kpis">
          <AccordionTrigger>KPI e regole di test</AccordionTrigger>
          <AccordionContent>
            <Stack gap={3}>
              <ul className="ad-list">
                {proposal.kpis.map((kpi) => (
                  <li key={kpi}>{kpi}</li>
                ))}
              </ul>
              <dl className="rows">
                <Fact label="Da testare per primo" value={proposal.test_rules.first} />
                <Fact label="Se non genera interesse" value={proposal.test_rules.no_interest} />
                <Fact label="Se genera lead ma non appuntamenti" value={proposal.test_rules.leads_no_appointments} />
                <Fact label="Se genera appuntamenti ma poche vendite" value={proposal.test_rules.appointments_no_sales} />
              </dl>
              <ItemDescription>{budget.note}</ItemDescription>
            </Stack>
          </AccordionContent>
        </AccordionItem>
        {proposal.missing_data.length > 0 && (
          <AccordionItem value="missing">
            <AccordionTrigger>Dati mancanti</AccordionTrigger>
            <AccordionContent>
              <ul className="ad-list">
                {proposal.missing_data.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

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
