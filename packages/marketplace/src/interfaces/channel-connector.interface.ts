import type { Marketplace, UnifiedListing } from '@flipsync/core'

// ─── Port `ChannelConnector` (ADAPTER-CONTRACT §3, one-way door, gate P2) ─────
// Transcription du contrat gelé — ce fichier n'améliore ni n'étend le port.
// Nom `channel` conservé tel que documenté (`SalesChannel` dans l'artefact,
// `Marketplace` en SSOT code — Q9, MASTER-REMED, ERRATA E-7 : nommage tranché
// ailleurs, sans effet ici). C3 (refonte) : n'est plus dormant — CoreSyncPublisher
// et les connecteurs migrés le consomment/l'implémentent.

/**
 * Capability matrix v1 (ADAPTER-CONTRACT §4 — « données, pas de code »).
 * Typage minimal des colonnes de la matrice — tranché 2026-07-14 (réponse
 * utilisateur, cf. commit) : simple typage des données de capacité existantes,
 * aucune abstraction ni logique métier nouvelle.
 */
export interface ChannelCapabilities {
  readonly kind: 'MP' | 'SF'
  readonly transport: 'direct' | 'agrégateur'
  /** D4 — un seul cerveau de négociation par canal, fonction pure de cette valeur. */
  readonly negotiation: 'NATIVE' | 'APP_SIDE' | 'NONE'
  readonly publishMode: 'SYNC' | 'ASYNC'
  readonly photosPerso: boolean
  readonly productRef: boolean
  readonly seller: 'individual' | 'professional' | 'both'
  readonly retractSla: string | null
}

export type IneligibilityReason = string

export type Eligibility =
  | { eligible: true }
  | { eligible: false; reasons: readonly IneligibilityReason[] }

/**
 * Sortie de `publish()` — sync, async (feed) ou échec typé (transitoire/permanent).
 * `url` nullable (tranché C3.3, réponse utilisateur 2026-07-15) : certains
 * partenaires (ex. eBay Inventory API) confirment `externalId` sans toujours
 * renvoyer d'URL publique exploitable dans le même appel — cohérent avec
 * `SyncSuccess.url: string | null` déjà établi côté Core Sync Engine v2.
 */
export type PublishOutcome =
  | { status: 'PUBLISHED'; externalId: string; url: string | null; externalMeta?: unknown } // sync
  | { status: 'SUBMITTED'; submissionRef: string } // async (feed)
  | { status: 'FAILED'; kind: 'TRANSIENT' | 'PERMANENT'; code: string } // SNAKE_CASE

/** Référence de publication — possédée par l'adapter, opaque au core (ERRATA E-9). */
export interface PublicationRef {
  readonly externalId: string
  readonly externalMeta?: unknown
}

/** Sortie de `update()`/`retract()` — miroir de `PublishOutcome.FAILED`. */
export type OpOutcome =
  | { ok: true }
  | { ok: false; kind: 'TRANSIENT' | 'PERMANENT'; code: string }

export type RetractReason = 'SOLD_ELSEWHERE' | 'USER' | 'POLICY'

/**
 * Événement canal normalisé (webhook/poll → forme unique).
 * `eventKey` obligatoire (A1) — dédup à l'ingestion par `(channel, eventKey)`.
 * `pubRef` = clé de corrélation opaque vers la publication existante ; absente
 * uniquement sur `PUBLISH_CONFIRMED`, l'événement qui ÉTABLIT `externalId`
 * (corrélation par (listingId, channel, epoch) à l'ingestion — ERRATA E-10).
 */
export type NormalizedChannelEvent = { eventKey: string } & (
  | { type: 'PUBLISH_CONFIRMED'; externalId: string; url: string; externalMeta?: unknown }
  | { type: 'PUBLISH_REJECTED'; pubRef: string; code: string }
  | { type: 'OFFER_RECEIVED'; pubRef: string; amountCents: number; buyerRef: string }
  | { type: 'MESSAGE_RECEIVED'; pubRef: string; text: string; buyerRef: string }
  | { type: 'SOLD'; pubRef: string; amountCents: number }
  | { type: 'RETRACT_CONFIRMED'; pubRef: string }
  | { type: 'LISTING_ENDED'; pubRef: string; cause: 'EXPIRED' | 'CHANNEL_POLICY' }
)

/** Credentials partenaire — opaque au core, structure propre à chaque connecteur. */
export type ChannelCredentials = unknown

/** Contexte vendeur consommé par `precheck` (mandat, statut pro, etc.) — opaque ici. */
export type SellerContext = unknown

/**
 * Pivot canonique consommé par `precheck`/`publish`/`update`. Concrétisé sur
 * `UnifiedListing` (tranché C3.3, réponse utilisateur 2026-07-15) — élimine le
 * cast `as UnifiedListing` que chaque implémentation aurait sinon dû faire :
 * le pivot n'est PAS redéfini ici, c'est le même type que le Core Sync Engine
 * v2 (@flipsync/core), simplement rendu concret au lieu d'`unknown`.
 */
export type CanonicalListing = UnifiedListing

/**
 * Port complet — remplace `MarketplaceConnector.publish()` seul (C3).
 * Interdits par contrat (§3) : aucune méthode enchère (D2), aucune méthode
 * bundle (D3), aucun accès wallet (§8), aucun type spécifique canal exporté
 * hors de ce package.
 */
export interface ChannelConnector {
  readonly channel: Marketplace
  readonly capabilities: ChannelCapabilities

  /** Éligibilité AVANT authorize/débit. Pur ou I/O léger. Raisons lisibles user. */
  precheck(listing: CanonicalListing, seller: SellerContext): Eligibility

  /** Idempotent — clé = (listingId, channel, epoch). Republier ne duplique jamais. */
  publish(listing: CanonicalListing, credentials: ChannelCredentials): Promise<PublishOutcome>
  update(ref: PublicationRef, listing: CanonicalListing, credentials: ChannelCredentials): Promise<OpOutcome>
  retract(ref: PublicationRef, credentials: ChannelCredentials, why: RetractReason): Promise<OpOutcome>

  /** Webhook/poll brut → événement normalisé. `null` = bruit à ignorer. */
  parseEvent(raw: unknown): NormalizedChannelEvent | null
}

/** Registre des connecteurs port — une entrée par plateforme activée (C3, remplace ConnectorRegistry). */
export type ChannelConnectorRegistry = ReadonlyMap<Marketplace, ChannelConnector>
