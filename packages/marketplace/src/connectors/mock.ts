import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Marketplace } from '@flipsync/core'
import type {
  CanonicalListing,
  ChannelCapabilities,
  ChannelConnector,
  ChannelCredentials,
  Eligibility,
  NormalizedChannelEvent,
  OpOutcome,
  PublicationRef,
  PublishOutcome,
  RetractReason,
  SellerContext,
} from '../interfaces/channel-connector.interface'

/** Entrée journalisée par le mock — une par publication simulée. */
export interface MockPublishLogEntry {
  publishedAt: string
  marketplace: Marketplace
  externalId: string
  url: string
  payload: CanonicalListing
  sellerId: string | null
}

/**
 * MockMarketplacePublisher — connecteur de TEST (jamais en production), natif
 * ChannelConnector (C3.6). Au lieu d'appeler l'API partenaire, il écrit la
 * publication dans un fichier JSON (debug/publish_log.json) pour valider le
 * pipeline serveur de bout en bout sans credentials ni device mobile.
 * L'engine ne transmet jamais de credentials réelles (cf. sync-publisher.ts) —
 * ce simulateur n'en a donc besoin d'aucune, ni ne filtre de capacité réelle.
 */
export class MockMarketplacePublisher implements ChannelConnector {
  /**
   * Sérialise les écritures du log ENTRE instances : CoreSyncPublisher publie
   * les plateformes en parallèle (allSettled) et deux mocks partagent le même
   * fichier — sans verrou, le read-modify-write concurrent corrompt le JSON.
   */
  private static writeLock: Promise<unknown> = Promise.resolve()

  readonly channel: Marketplace
  readonly capabilities: ChannelCapabilities = {
    kind: 'MP',
    transport: 'direct',
    negotiation: 'NONE',
    publishMode: 'SYNC',
    photosPerso: false,
    productRef: false,
    seller: 'both',
    retractSla: null,
  }

  constructor(
    marketplace: Marketplace,
    private readonly logPath: string,
  ) {
    this.channel = marketplace
  }

  precheck(_listing: CanonicalListing, _seller: SellerContext): Eligibility {
    return { eligible: true }
  }

  async publish(listing: CanonicalListing, _credentials: ChannelCredentials): Promise<PublishOutcome> {
    const externalId = `mock-${this.channel.toLowerCase()}-${Date.now()}`
    const entry: MockPublishLogEntry = {
      publishedAt: new Date().toISOString(),
      marketplace: this.channel,
      externalId,
      url: `https://mock.flipsync.local/${this.channel.toLowerCase()}/${externalId}`,
      payload: listing,
      sellerId: null,
    }

    const write = MockMarketplacePublisher.writeLock.then(async (): Promise<PublishOutcome> => {
      try {
        await mkdir(dirname(this.logPath), { recursive: true })
        const existing = await readFile(this.logPath, 'utf8').catch(() => '[]')
        const log = JSON.parse(existing) as MockPublishLogEntry[]
        log.push(entry)
        await writeFile(this.logPath, JSON.stringify(log, null, 2), 'utf8')
      } catch {
        return { status: 'FAILED', kind: 'PERMANENT', code: 'MOCK_LOG_WRITE_FAILED' }
      }
      return { status: 'PUBLISHED', externalId, url: entry.url }
    })
    MockMarketplacePublisher.writeLock = write.catch(() => {})
    return write
  }

  async update(
    _ref: PublicationRef,
    _listing: CanonicalListing,
    _credentials: ChannelCredentials,
  ): Promise<OpOutcome> {
    return { ok: true }
  }

  async retract(_ref: PublicationRef, _credentials: ChannelCredentials, _why: RetractReason): Promise<OpOutcome> {
    return { ok: true }
  }

  parseEvent(_raw: unknown): NormalizedChannelEvent | null {
    return null
  }
}
