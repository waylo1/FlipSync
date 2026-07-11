import { Mission, MissionStatus, Prisma, PrismaClient } from '@flipsync/db'
import {
  ComplexCasePolicy,
  DeliveryPreference,
  IncomingMessage,
  MissionEvent as CoreMissionEvent,
  MissionStatus as CoreMissionStatus,
  NegotiationAction,
  SellMandate,
  SellObjective,
  SellPosture,
  applyMissionEvent,
  decideNegotiation,
  redactOutboundMessage,
} from '@flipsync/core'

/**
 * @flipsync/db génère son propre enum MissionStatus (Prisma Client) — même
 * valeurs que celui de @flipsync/core (généré depuis le même schema.prisma,
 * cf. generate-enums.mjs), mais nominalement distinct pour TypeScript. Seule
 * conversion tolérée : les deux SONT la même donnée, jamais mappée à la main.
 */
const asCoreStatus = (status: MissionStatus): CoreMissionStatus => status as unknown as CoreMissionStatus
const asPrismaStatus = (status: CoreMissionStatus): MissionStatus => status as unknown as MissionStatus
const transition = (status: MissionStatus, event: CoreMissionEvent): MissionStatus =>
  asPrismaStatus(applyMissionEvent(asCoreStatus(status), event))

/** Erreur métier — code SNAKE_CASE mappé en HTTP par l'error-handler. */
export class NegotiationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'NegotiationError'
  }
}

const eur = (cents: number): string =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100)

/** Mission (colonnes String, cf. schema.prisma) → SellMandate typé — la SEULE conversion autorisée. */
const toMandate = (mission: Mission): SellMandate => ({
  posture: mission.posture as SellPosture,
  objectif: mission.objectif as SellObjective,
  prixAffiche: mission.prixAffiche,
  prixMini: mission.prixMini,
  livraison: mission.livraison as DeliveryPreference,
  casComplexes: mission.casComplexes as ComplexCasePolicy,
  autoAdjugeAuDessusDuMini: mission.autoAdjugeAuDessusDuMini,
})

const buyerOf = (message: IncomingMessage): { buyerId: string; buyerName: string } =>
  message.kind === 'OFFER'
    ? { buyerId: message.offer.buyerId, buyerName: message.offer.buyerName }
    : { buyerId: message.buyerId, buyerName: message.buyerName }

interface EventDraft {
  kind: string
  summary: string
  amount?: number
  buyerName?: string
}

/**
 * MissionNegotiationService — Lot 5 (COMMISSAIRE_PRISEUR_PLAN.md §5.4/§10).
 * Fait vivre le tableau de bord S4 : lecture (dashboard), actions vendeur
 * (suspendre/reprendre/arrêter, menu ⋯) et alimentation par le canal simulé
 * (`simulateMessage`, dev/démo — le canal réel arrivera au Lot 9 derrière la
 * même frontière `NegotiationChannel`, cf. @flipsync/core).
 */
export class MissionNegotiationService {
  constructor(private readonly prisma: PrismaClient) {}

  async getDashboard(userId: string, missionId: string) {
    const mission = await this.findOwned(userId, missionId)
    const events = await this.prisma.missionEvent.findMany({
      where: { missionId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return { mission, events }
  }

  async getDashboardByListing(userId: string, listingId: string) {
    const mission = await this.prisma.mission.findFirst({ where: { listingId, userId } })
    if (!mission) throw new NegotiationError('MISSION_NOT_FOUND')
    return this.getDashboard(userId, mission.id)
  }

  /** Menu ⋯ — réversible : mémorise l'état à restaurer dans preSuspendStatus. */
  async suspend(userId: string, missionId: string): Promise<Mission> {
    const mission = await this.findOwned(userId, missionId)
    const status = transition(mission.status, { type: 'SUSPENDED' })
    return this.prisma.mission.update({
      where: { id: missionId },
      data: { status, preSuspendStatus: mission.status },
    })
  }

  async resume(userId: string, missionId: string): Promise<Mission> {
    const mission = await this.findOwned(userId, missionId)
    if (mission.preSuspendStatus === null) throw new NegotiationError('NOTHING_TO_RESUME')
    const status = transition(mission.status, {
      type: 'RESUMED',
      to: asCoreStatus(mission.preSuspendStatus),
    })
    return this.prisma.mission.update({
      where: { id: missionId },
      data: { status, preSuspendStatus: null },
    })
  }

  /** Menu ⋯ — l'IA cesse, l'annonce reste en ligne, vente redevient manuelle. Non réversible. */
  async stop(userId: string, missionId: string): Promise<Mission> {
    const mission = await this.findOwned(userId, missionId)
    const status = transition(mission.status, { type: 'STOPPED' })
    return this.prisma.mission.update({ where: { id: missionId }, data: { status } })
  }

  /**
   * Injecte un message dans le canal simulé et applique R1–R9 (§8) + la
   * machine à états (§6). Dev/démo uniquement — gardé par `devActionsEnabled`
   * dans la route, jamais exposé en production (§1).
   */
  async simulateMessage(userId: string, missionId: string, message: IncomingMessage): Promise<Mission> {
    const mission = await this.findOwned(userId, missionId)
    const mandate = toMandate(mission)
    const action = decideNegotiation(mandate, message)
    return this.applyAction(mission, message, action)
  }

  /**
   * S5 — le coup de marteau (§5.5, R4). Résout la validation en attente :
   * ACCEPT (offre/prix mini uniquement) confirme la vente, CONTINUE relance la
   * négociation sans engager, DECLINE refuse (offre, sortie de circuit, cas
   * hors mandat). `VALIDATION_NOT_PENDING` couvre le cas « offre retirée » :
   * si la feuille S5 est restée ouverte pendant que l'état a changé ailleurs,
   * on ne laisse jamais accepter une offre qui n'est plus là.
   */
  async resolveValidation(
    userId: string,
    missionId: string,
    action: 'ACCEPT' | 'CONTINUE' | 'DECLINE',
  ): Promise<Mission> {
    const mission = await this.findOwned(userId, missionId)
    if (mission.status !== MissionStatus.EN_ATTENTE_VALIDATION) {
      throw new NegotiationError('VALIDATION_NOT_PENDING')
    }
    const reason = mission.pendingReason
    const buyerName = mission.pendingBuyerName ?? 'l’acheteur'
    const amount = mission.pendingOfferAmount

    if (action === 'ACCEPT') {
      if (reason !== 'OFFER' && reason !== 'OFFER_AT_FLOOR') {
        throw new NegotiationError('ACTION_NOT_ALLOWED')
      }
      if (amount === null) throw new NegotiationError('VALIDATION_NOT_PENDING')

      const status = transition(mission.status, { type: 'SALE_CONFIRMED' })
      return this.commit(
        mission.id,
        {
          status,
          soldAmount: amount,
          soldAt: new Date(),
          bestOfferAmount: Math.max(mission.bestOfferAmount ?? 0, amount),
          pendingReason: null,
          pendingOfferAmount: null,
          pendingBuyerName: null,
        },
        { kind: 'SALE_CONFIRMED', summary: `Vendu ${eur(amount)} — validé par vous`, amount, buyerName },
      )
    }

    const status = transition(mission.status, { type: 'VALIDATION_RESOLVED' })
    const summary =
      action === 'CONTINUE'
        ? `Négociation reprise avec ${buyerName}`
        : declineResolutionSummary(reason, buyerName)
    return this.commit(
      mission.id,
      { status, pendingReason: null, pendingOfferAmount: null, pendingBuyerName: null },
      { kind: action, summary, buyerName },
    )
  }

  private async commit(missionId: string, data: Prisma.MissionUpdateInput, draft: EventDraft): Promise<Mission> {
    const [updated] = await this.prisma.$transaction([
      this.prisma.mission.update({ where: { id: missionId }, data }),
      this.prisma.missionEvent.create({
        data: { missionId, kind: draft.kind, summary: draft.summary, amount: draft.amount, buyerName: draft.buyerName },
      }),
    ])
    return updated
  }

  private async findOwned(userId: string, missionId: string): Promise<Mission> {
    const mission = await this.prisma.mission.findFirst({ where: { id: missionId, userId } })
    if (!mission) throw new NegotiationError('MISSION_NOT_FOUND')
    return mission
  }

  private async applyAction(
    mission: Mission,
    message: IncomingMessage,
    action: NegotiationAction,
  ): Promise<Mission> {
    const { buyerId, buyerName } = buyerOf(message)
    let status = mission.status

    // Premier contact d'une négociation : sortir de la veille avant tout autre effet.
    if (status === MissionStatus.EN_VENTE) {
      status = transition(status, { type: 'BUYER_MESSAGE' })
    }

    const isNewBuyer =
      (await this.prisma.missionEvent.count({ where: { missionId: mission.id, buyerName } })) === 0

    const data: Prisma.MissionUpdateInput = {}
    const draft: EventDraft = { kind: action.type, summary: '', buyerName }

    switch (action.type) {
      case 'AUTO_REPLY':
        draft.summary = redactOutboundMessage(autoReplySummary(message.kind, buyerName))
        break

      case 'AUTO_ACCEPT':
        status = transition(status, { type: 'SALE_CONFIRMED' })
        data.soldAmount = action.amount
        data.soldAt = new Date()
        data.bestOfferAmount = Math.max(mission.bestOfferAmount ?? 0, action.amount)
        draft.summary = `Vendu ${eur(action.amount)} — adjugé seule selon le mandat`
        draft.amount = action.amount
        break

      case 'REQUIRE_VALIDATION': {
        status = transition(status, { type: 'VALIDATION_REQUIRED' })
        data.pendingReason = action.reason
        data.pendingBuyerName = buyerName
        const offerAmount = message.kind === 'OFFER' ? message.offer.amount : undefined
        if (offerAmount !== undefined) {
          data.pendingOfferAmount = offerAmount
          data.bestOfferAmount = Math.max(mission.bestOfferAmount ?? 0, offerAmount)
        }
        draft.summary = requireValidationSummary(action.reason, buyerName, offerAmount)
        draft.amount = offerAmount
        break
      }

      case 'DECLINE':
        draft.summary = declineSummary(action.reason, buyerName)
        break

      case 'CONTINUE_NO_COMMIT':
        draft.summary = `Cas complexe signalé par ${buyerName} — contact maintenu, rien engagé.`
        break
    }

    data.status = status
    if (isNewBuyer) data.activeBuyerCount = { increment: 1 }

    const [updated] = await this.prisma.$transaction([
      this.prisma.mission.update({ where: { id: mission.id }, data }),
      this.prisma.missionEvent.create({
        data: { missionId: mission.id, kind: draft.kind, summary: draft.summary, amount: draft.amount, buyerName: draft.buyerName },
      }),
    ])

    void buyerId // conservé pour un futur suivi par acheteur (Lot 6/9) — pas encore de table Buyer dédiée.
    return updated
  }
}

function autoReplySummary(kind: IncomingMessage['kind'], buyerName: string): string {
  switch (kind) {
    case 'QUESTION':
      return `Question répondue (${buyerName})`
    case 'DELIVERY_REQUEST':
      return `Mode de livraison confirmé à ${buyerName}`
    default:
      return `Réponse envoyée à ${buyerName}`
  }
}

function requireValidationSummary(
  reason: Extract<NegotiationAction, { type: 'REQUIRE_VALIDATION' }>['reason'],
  buyerName: string,
  amount: number | undefined,
): string {
  switch (reason) {
    case 'OFFER':
      return `Offre de ${buyerName}${amount !== undefined ? ` à ${eur(amount)}` : ''}`
    case 'OFFER_AT_FLOOR':
      return `Offre de ${buyerName} au prix mini${amount !== undefined ? ` (${eur(amount)})` : ''}`
    case 'COMPLEX_CASE':
      return `Cas hors mandat signalé par ${buyerName}`
    case 'SECURITY_ALERT':
      return `${buyerName} tente de sortir du circuit sécurisé`
  }
}

/** S5 — libellé de la ligne timeline quand le vendeur refuse/bloque en résolvant une validation. */
function declineResolutionSummary(reason: string | null, buyerName: string): string {
  switch (reason) {
    case 'OFFER':
    case 'OFFER_AT_FLOOR':
      return `Offre de ${buyerName} refusée par vous`
    case 'SECURITY_ALERT':
      return `${buyerName} bloqué — sortie du circuit sécurisé refusée`
    case 'COMPLEX_CASE':
      return `Demande de ${buyerName} refusée par vous`
    default:
      return `Demande de ${buyerName} refusée par vous`
  }
}

function declineSummary(
  reason: Extract<NegotiationAction, { type: 'DECLINE' }>['reason'],
  buyerName: string,
): string {
  switch (reason) {
    case 'BELOW_FLOOR':
      return `Offre de ${buyerName} refusée — sous le prix mini`
    case 'DELIVERY_NOT_ALLOWED':
      return `Mode de livraison refusé à ${buyerName} — hors mandat`
    case 'COMPLEX_CASE_REFUSED':
      return `Demande de ${buyerName} déclinée — hors mandat`
  }
}
