import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  ListingPayload,
  Marketplace,
  MarketplaceConnector,
  MarketplaceCredentials,
  PublishResult,
} from '../types'

/** Entrée journalisée par le mock — une par publication simulée. */
export interface MockPublishLogEntry {
  publishedAt: string
  marketplace: Marketplace
  externalId: string
  url: string
  payload: ListingPayload
  sellerId: string | null
}

/**
 * MockMarketplacePublisher — connecteur de TEST (jamais en production).
 * Au lieu d'appeler l'API partenaire, il écrit la publication dans un fichier
 * JSON (debug/publish_log.json) pour valider le pipeline serveur de bout en
 * bout sans credentials ni device mobile. Même contrat que les connecteurs
 * réels : ne lève jamais, tout échec est un PublishResult { ok:false }.
 */
export class MockMarketplacePublisher implements MarketplaceConnector {
  constructor(
    readonly marketplace: Marketplace,
    private readonly logPath: string,
  ) {}

  async publish(
    payload: ListingPayload,
    credentials: MarketplaceCredentials,
  ): Promise<PublishResult> {
    if (!credentials.accessToken) return { ok: false, code: 'MARKETPLACE_CREDENTIALS_MISSING' }

    const externalId = `mock-${this.marketplace.toLowerCase()}-${Date.now()}`
    const entry: MockPublishLogEntry = {
      publishedAt: new Date().toISOString(),
      marketplace: this.marketplace,
      externalId,
      url: `https://mock.flipsync.local/${this.marketplace.toLowerCase()}/${externalId}`,
      payload,
      sellerId: credentials.sellerId ?? null,
    }

    try {
      await mkdir(dirname(this.logPath), { recursive: true })
      const existing = await readFile(this.logPath, 'utf8').catch(() => '[]')
      const log = JSON.parse(existing) as MockPublishLogEntry[]
      log.push(entry)
      await writeFile(this.logPath, JSON.stringify(log, null, 2), 'utf8')
    } catch {
      return { ok: false, code: 'MOCK_LOG_WRITE_FAILED' }
    }

    return { ok: true, externalId, url: entry.url }
  }
}
