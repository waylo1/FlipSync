import {
  Marketplace,
  SyncErrorCode,
  type RemoteStatusOutcome,
  type SyncFailure,
  type SyncOutcome,
  type UnifiedListing,
} from '@flipsync/core'
import type { ConnectorCapabilities, MarketplaceConnector } from '../interfaces/connector.interface'
import type { ListingPayload, MarketplaceCredentials, PublishResult } from '../types'

/** Résolution de credentials fournie par l'appelant (structurellement compatible
 *  avec CredentialResolution de l'api — le champ mock supplémentaire est ignoré). */
export type LegacyCredentialResolution =
  | { ok: true; credentials: MarketplaceCredentials }
  | { ok: false; reason: 'MISSING' | 'EXPIRED' }

export interface LegacyConnectorAdapterDeps {
  /** Lecture paresseuse — jamais figée à la construction (env mutable en test). */
  resolveCredentials: () => LegacyCredentialResolution
  /**
   * Pivot → payload v1. C'est ICI que vit le mapping catégorie par plateforme
   * (categorieLbc vs categorieVinted) : l'adaptateur est construit PAR REQUÊTE
   * par le service api avec la catégorie du listing courant.
   */
  toPayload: (listing: UnifiedListing) => ListingPayload
  /** Publication v1 (MarketplaceClient.publish lié à la plateforme). */
  publishV1: (payload: ListingPayload, credentials: MarketplaceCredentials) => Promise<PublishResult>
  /** Hook post-tentative — branche reportPublishOutcome (état AUTH_ERROR /marketplace/status). */
  onResult?: (result: PublishResult) => void
}

/** Codes v1 (SNAKE_CASE libres) → codes sync normalisés (union fermée). */
const mapLegacyCode = (code: string): SyncErrorCode => {
  if (code.includes('CREDENTIALS')) return SyncErrorCode.CREDENTIALS_MISSING
  if (/NETWORK|TIMEOUT/.test(code)) return SyncErrorCode.NETWORK_ERROR
  if (code.includes('RATE')) return SyncErrorCode.RATE_LIMITED
  return SyncErrorCode.REMOTE_REJECTED
}

const RETRYABLE_CODES: readonly SyncErrorCode[] = [
  SyncErrorCode.NETWORK_ERROR,
  SyncErrorCode.RATE_LIMITED,
]

/**
 * Adaptateur contrat v1 (publish seul) → MarketplaceConnector v2 (ADR-009).
 * Fait entrer les connecteurs LBC/Vinted (et leur mock) dans le pipeline
 * CoreSyncPublisher sans les réécrire. Disparaîtra avec la migration des
 * connecteurs v1 vers le contrat v2.
 */
export class LegacyConnectorAdapter implements MarketplaceConnector {
  /** v1 = prix fixe uniquement — aucune enchère sur LBC/Vinted. */
  readonly capabilities: ConnectorCapabilities = { modes: ['fixed'] }

  constructor(
    readonly marketplace: Marketplace,
    private readonly deps: LegacyConnectorAdapterDeps,
  ) {}

  async publish(listing: UnifiedListing): Promise<SyncOutcome> {
    const resolution = this.deps.resolveCredentials()
    if (!resolution.ok) {
      return {
        ok: false,
        code: SyncErrorCode.CREDENTIALS_MISSING,
        detail: `credentials ${resolution.reason} — ${this.marketplace}`,
        retryable: false,
      }
    }
    const result = await this.deps.publishV1(this.deps.toPayload(listing), resolution.credentials)
    this.deps.onResult?.(result)
    if (result.ok) return { ok: true, externalId: result.externalId, url: result.url }
    const code = mapLegacyCode(result.code)
    // detail = code v1 brut (ex. VINTED_HTTP_401) — alimente failureReason/logs.
    return { ok: false, code, detail: result.code, retryable: RETRYABLE_CODES.includes(code) }
  }

  private unsupported(op: string): SyncFailure {
    return {
      ok: false,
      code: SyncErrorCode.CONNECTOR_UNAVAILABLE,
      detail: `${op} non supporté par le connecteur v1 ${this.marketplace} (publish seul)`,
      retryable: false,
    }
  }

  async update(_externalId: string, _listing: UnifiedListing): Promise<SyncOutcome> {
    return this.unsupported('update')
  }

  async withdraw(_externalId: string): Promise<SyncOutcome> {
    return this.unsupported('withdraw')
  }

  async checkStatus(_externalId: string): Promise<RemoteStatusOutcome> {
    return this.unsupported('checkStatus')
  }
}
