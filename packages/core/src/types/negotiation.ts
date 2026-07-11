import { MissionStatus } from '../generated/enums'
import { ComplexCasePolicy, DeliveryPreference, SellMandate } from './mission'

// ─── Commissaire-Priseur IA — Lot 4 : canal simulé + garde-fous R1–R9 ──────────
// Réflexion et décisions : COMMISSAIRE_PRISEUR_PLAN.md §6 (machine à états),
// §8 (règles R1–R9) et §9 (frontière NegotiationChannel).
// Tout ici est pur (aucune I/O) : c'est le contrat que respectera un jour le
// connecteur réel (Lot 9). Ne contient PAS la stratégie de négociation de l'IA
// (quand/combien concéder) : R1–R9 sont des garde-fous déterministes, pas du
// raisonnement — ce dernier reste hors périmètre de ce lot.

// ─── R9 — signaux de confiance publics uniquement (jamais de réputation propriétaire) ─
export interface BuyerSignals {
  readonly verified: boolean
}

export interface IncomingOffer {
  readonly buyerId: string
  readonly buyerName: string
  readonly amount: number // centimes
  readonly signals: BuyerSignals
}

/** Un message entrant du canal, déjà classifié par kind (la classification fine reste côté IA/connecteur). */
export type IncomingMessage =
  | { kind: 'QUESTION'; buyerId: string; buyerName: string; text: string }
  | { kind: 'OFFER'; offer: IncomingOffer }
  | { kind: 'DELIVERY_REQUEST'; buyerId: string; buyerName: string; mode: DeliveryPreference }
  | { kind: 'OFF_PLATFORM_PAYMENT'; buyerId: string; buyerName: string; text: string }
  | { kind: 'COMPLEX_CASE'; buyerId: string; buyerName: string; question: string }

export type NegotiationAction =
  | { type: 'AUTO_REPLY' }
  | { type: 'AUTO_ACCEPT'; amount: number }
  | {
      type: 'REQUIRE_VALIDATION'
      reason: 'OFFER' | 'OFFER_AT_FLOOR' | 'COMPLEX_CASE' | 'SECURITY_ALERT'
    }
  | { type: 'DECLINE'; reason: 'BELOW_FLOOR' | 'DELIVERY_NOT_ALLOWED' | 'COMPLEX_CASE_REFUSED' }
  | { type: 'CONTINUE_NO_COMMIT' }

const isDeliveryAllowed = (pref: DeliveryPreference, requested: DeliveryPreference): boolean =>
  pref === DeliveryPreference.LES_DEUX || pref === requested

/**
 * Applique R1, R3, R5, R6 : décide quoi faire d'un message entrant, sans jamais
 * engager de vente sous le prix mini ni hors du mandat. Le coup de marteau (R4)
 * est tranché ici pour les offres : validation humaine sauf opt-in explicite.
 */
export function decideNegotiation(mandate: SellMandate, message: IncomingMessage): NegotiationAction {
  switch (message.kind) {
    case 'QUESTION':
      // §2.1 — réponse factuelle déjà présente dans l'annonce ; le texte exact
      // (rédaction) est hors périmètre de ce lot, seul le contrôle l'est.
      return { type: 'AUTO_REPLY' }

    case 'OFF_PLATFORM_PAYMENT':
      // R3 — jamais accepté seul : on alerte, on ne coupe pas la conversation.
      return { type: 'REQUIRE_VALIDATION', reason: 'SECURITY_ALERT' }

    case 'DELIVERY_REQUEST':
      // R5 — n'accepter que les modes autorisés par le mandat.
      return isDeliveryAllowed(mandate.livraison, message.mode)
        ? { type: 'AUTO_REPLY' }
        : { type: 'DECLINE', reason: 'DELIVERY_NOT_ALLOWED' }

    case 'COMPLEX_CASE':
      // R6 — route selon la politique choisie au mandat (§4.4).
      switch (mandate.casComplexes) {
        case ComplexCasePolicy.ME_DEMANDER:
          return { type: 'REQUIRE_VALIDATION', reason: 'COMPLEX_CASE' }
        case ComplexCasePolicy.REFUSER:
          return { type: 'DECLINE', reason: 'COMPLEX_CASE_REFUSED' }
        case ComplexCasePolicy.CONTINUER:
          return { type: 'CONTINUE_NO_COMMIT' }
      }
      break

    case 'OFFER': {
      const { amount } = message.offer
      // R1 — plancher dur, non désactivable. Rien en dessous n'est même transmis à la validation.
      if (amount < mandate.prixMini) {
        return { type: 'DECLINE', reason: 'BELOW_FLOOR' }
      }
      // R4 — coup de marteau : zéro-clic uniquement si l'opt-in est actif ET offre ≥ prixMini (déjà garanti ici).
      if (mandate.autoAdjugeAuDessusDuMini) {
        return { type: 'AUTO_ACCEPT', amount }
      }
      // §2.3 — offre exactement au plancher : variante dédiée pour l'écran de validation (S5).
      if (amount === mandate.prixMini) {
        return { type: 'REQUIRE_VALIDATION', reason: 'OFFER_AT_FLOOR' }
      }
      return { type: 'REQUIRE_VALIDATION', reason: 'OFFER' }
    }
  }
}

// ─── R2 — confidentialité : aucun message sortant ne fuite de coordonnées ─────
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const URL_RE = /\bhttps?:\/\/\S+/gi
const PHONE_RE = /(?:\+\d{1,3}[ .-]?)?\b\d[\d .-]{7,}\d\b/g

/** Filtre non désactivable appliqué à tout texte sortant avant envoi (R2). */
export function redactOutboundMessage(text: string): string {
  return text
    .replace(EMAIL_RE, '[coordonnées masquées]')
    .replace(URL_RE, '[lien masqué]')
    .replace(PHONE_RE, '[coordonnées masquées]')
}

// ─── R7 — relance unique, jamais de harcèlement ────────────────────────────────
/** Un acheteur tiède ne reçoit au plus qu'une relance (R7). */
export const canSendReminder = (alreadyReminded: boolean): boolean => !alreadyReminded

// ─── §6 — machine à états de la Mission ────────────────────────────────────────

export type MissionEvent =
  | { type: 'MANDATE_CONFIRMED' }
  | { type: 'BUYER_MESSAGE' }
  | { type: 'VALIDATION_REQUIRED' }
  | { type: 'VALIDATION_RESOLVED' }
  | { type: 'SALE_CONFIRMED' }
  | { type: 'MISSION_FINALIZED' }
  | { type: 'SUSPENDED' }
  | { type: 'RESUMED'; to: MissionStatus }
  | { type: 'STOPPED' }
  | { type: 'EXPIRED' }

export class MissionTransitionError extends Error {
  constructor(
    readonly from: MissionStatus,
    readonly event: MissionEvent['type'],
  ) {
    super(`Transition invalide : ${from} + ${event}`)
    this.name = 'MissionTransitionError'
  }
}

/** États depuis lesquels une mission suspendue peut reprendre (§6, transitions transverses). */
const RESUMABLE_STATES: readonly MissionStatus[] = [
  MissionStatus.EN_VENTE,
  MissionStatus.NEGOCIATION_ACTIVE,
  MissionStatus.EN_ATTENTE_VALIDATION,
]

const TRANSITIONS: Partial<Record<MissionStatus, Partial<Record<MissionEvent['type'], MissionStatus>>>> = {
  [MissionStatus.BROUILLON_MANDAT]: {
    MANDATE_CONFIRMED: MissionStatus.EN_VENTE,
  },
  [MissionStatus.EN_VENTE]: {
    BUYER_MESSAGE: MissionStatus.NEGOCIATION_ACTIVE,
    VALIDATION_REQUIRED: MissionStatus.EN_ATTENTE_VALIDATION,
    SUSPENDED: MissionStatus.SUSPENDUE,
    STOPPED: MissionStatus.ARRETEE,
    EXPIRED: MissionStatus.EXPIREE,
  },
  [MissionStatus.NEGOCIATION_ACTIVE]: {
    VALIDATION_REQUIRED: MissionStatus.EN_ATTENTE_VALIDATION,
    SALE_CONFIRMED: MissionStatus.VENDU,
    SUSPENDED: MissionStatus.SUSPENDUE,
    STOPPED: MissionStatus.ARRETEE,
    EXPIRED: MissionStatus.EXPIREE,
  },
  [MissionStatus.EN_ATTENTE_VALIDATION]: {
    VALIDATION_RESOLVED: MissionStatus.NEGOCIATION_ACTIVE,
    SALE_CONFIRMED: MissionStatus.VENDU,
    SUSPENDED: MissionStatus.SUSPENDUE,
    STOPPED: MissionStatus.ARRETEE,
  },
  [MissionStatus.VENDU]: {
    MISSION_FINALIZED: MissionStatus.MISSION_TERMINEE,
  },
}

/**
 * Applique un événement à l'état courant de la Mission (§6). Lève
 * `MissionTransitionError` pour toute transition non prévue par le schéma —
 * un garde-fou d'état ne se contourne pas plus qu'un garde-fou de prix.
 */
export function applyMissionEvent(current: MissionStatus, event: MissionEvent): MissionStatus {
  if (event.type === 'RESUMED') {
    if (current !== MissionStatus.SUSPENDUE || !RESUMABLE_STATES.includes(event.to)) {
      throw new MissionTransitionError(current, event.type)
    }
    return event.to
  }

  const next = TRANSITIONS[current]?.[event.type]
  if (!next) throw new MissionTransitionError(current, event.type)
  return next
}

// ─── §9 — frontière NegotiationChannel + canal simulé (démo/dev/tests) ─────────

export interface OutboundReply {
  readonly buyerId: string
  readonly text: string
}

/**
 * Adaptateur de canal (§1, §9). Tout le reste du produit ne connaît que cette
 * interface — c'est ce qui rend les six écrans livrables avant que l'accès
 * partenaire (Lot 9) existe.
 */
export interface NegotiationChannel {
  pull(): readonly IncomingMessage[]
  reply(msg: OutboundReply): void
  propose(buyerId: string, amount: number): void
  accept(buyerId: string): void
  reject(buyerId: string): void
}

/** Canal simulé — démo/dev/tests (§9). Messages injectables ; aucune I/O réelle. */
export class SimulatedChannel implements NegotiationChannel {
  private queue: IncomingMessage[] = []
  readonly sentReplies: OutboundReply[] = []
  readonly proposals: { buyerId: string; amount: number }[] = []
  readonly accepted: string[] = []
  readonly rejected: string[] = []

  /** Injecte un message de démonstration dans la file (démo/dev/tests uniquement). */
  inject(message: IncomingMessage): void {
    this.queue.push(message)
  }

  pull(): readonly IncomingMessage[] {
    const messages = this.queue
    this.queue = []
    return messages
  }

  reply(msg: OutboundReply): void {
    // R2 appliqué ici : aucun message sortant ne quitte le canal non filtré.
    this.sentReplies.push({ buyerId: msg.buyerId, text: redactOutboundMessage(msg.text) })
  }

  propose(buyerId: string, amount: number): void {
    this.proposals.push({ buyerId, amount })
  }

  accept(buyerId: string): void {
    this.accepted.push(buyerId)
  }

  reject(buyerId: string): void {
    this.rejected.push(buyerId)
  }
}
