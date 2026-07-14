import { describe, expect, it } from 'vitest'
import {
  ItemCondition,
  Marketplace,
  SyncErrorCode,
  type FixedPriceListing,
  type SyncOutcome,
  type UnifiedListing,
} from '@flipsync/core'
import type { ConnectorCapabilities, MarketplaceConnector } from './interfaces/connector.interface'
import { CoreSyncPublisher } from './sync-publisher'
import { EbayConnector } from './connectors/ebay'
import { ShopifyConnector } from './connectors/shopify'

const listing: FixedPriceListing = {
  mode: 'fixed',
  listingId: 'lst_1',
  titre: 'Vélo enfant 16 pouces',
  description: 'Très bon état, pneus récents.',
  etat: ItemCondition.bon,
  devise: 'EUR',
  marque: null,
  categorie: 'velos',
  prix: 4500,
  photos: [{ url: 'https://cdn.flipsync.fr/p1.jpg', order: 0 }],
}

/** Connecteur factice instrumenté — compte les appels pour prouver les gates sans réseau. */
class FakeConnector implements MarketplaceConnector {
  calls = 0
  readonly capabilities: ConnectorCapabilities

  constructor(
    readonly marketplace: Marketplace,
    private readonly behave: (l: UnifiedListing) => Promise<SyncOutcome>,
    modes: ConnectorCapabilities['modes'] = ['fixed'],
  ) {
    this.capabilities = { modes }
  }

  publish(l: UnifiedListing): Promise<SyncOutcome> {
    this.calls++
    return this.behave(l)
  }
  update(): Promise<SyncOutcome> {
    throw new Error('non testé ici')
  }
  withdraw(): Promise<SyncOutcome> {
    throw new Error('non testé ici')
  }
  checkStatus(): never {
    throw new Error('non testé ici')
  }
}

const success = (externalId: string): Promise<SyncOutcome> =>
  Promise.resolve({ ok: true, externalId, url: null })

const registry = (...connectors: MarketplaceConnector[]) =>
  new Map(connectors.map(c => [c.marketplace, c]))

describe('CoreSyncPublisher.publishMany', () => {
  it('publie sur toutes les plateformes — complete true, ordre des targets préservé', async () => {
    const lbc = new FakeConnector(Marketplace.LEBONCOIN, () => success('lbc-1'))
    const vinted = new FakeConnector(Marketplace.VINTED, () => success('vinted-1'))
    const publisher = new CoreSyncPublisher(registry(lbc, vinted))

    const report = await publisher.publishMany(listing, [Marketplace.VINTED, Marketplace.LEBONCOIN])

    expect(report.complete).toBe(true)
    expect(report.listingId).toBe('lst_1')
    expect(report.results.map(r => r.marketplace)).toEqual([Marketplace.VINTED, Marketplace.LEBONCOIN])
    expect(report.results.map(r => r.outcome.ok && r.outcome.externalId)).toEqual(['vinted-1', 'lbc-1'])
  })

  it('isole une panne : un connecteur qui throw devient CONNECTOR_CRASH, l\'autre publie', async () => {
    const crashing = new FakeConnector(Marketplace.LEBONCOIN, () => {
      throw new Error('boom interne')
    })
    const healthy = new FakeConnector(Marketplace.VINTED, () => success('vinted-1'))
    const publisher = new CoreSyncPublisher(registry(crashing, healthy))

    const report = await publisher.publishMany(listing, [Marketplace.LEBONCOIN, Marketplace.VINTED])

    expect(report.complete).toBe(false)
    const [lbc, vinted] = report.results
    expect(lbc?.outcome).toMatchObject({ ok: false, code: SyncErrorCode.CONNECTOR_CRASH, retryable: false })
    expect(lbc?.outcome.ok === false && lbc.outcome.detail).toContain('boom interne')
    expect(vinted?.outcome).toMatchObject({ ok: true, externalId: 'vinted-1' })
  })

  it('pivot invalide → INVALID_PAYLOAD pour toutes les cibles, zéro appel connecteur', async () => {
    const lbc = new FakeConnector(Marketplace.LEBONCOIN, () => success('x'))
    const publisher = new CoreSyncPublisher(registry(lbc))

    const report = await publisher.publishMany({ ...listing, prix: 0 }, [Marketplace.LEBONCOIN])

    expect(report.complete).toBe(false)
    expect(report.results).toEqual([
      {
        marketplace: Marketplace.LEBONCOIN,
        outcome: expect.objectContaining({ ok: false, code: SyncErrorCode.INVALID_PAYLOAD }),
      },
    ])
    expect(lbc.calls).toBe(0)
  })

  it('cible sans connecteur → CONNECTOR_UNAVAILABLE, les autres publient', async () => {
    const vinted = new FakeConnector(Marketplace.VINTED, () => success('vinted-1'))
    const publisher = new CoreSyncPublisher(registry(vinted))

    const report = await publisher.publishMany(listing, [Marketplace.EBAY, Marketplace.VINTED])

    expect(report.complete).toBe(false)
    expect(report.results[0]?.outcome).toMatchObject({ ok: false, code: SyncErrorCode.CONNECTOR_UNAVAILABLE })
    expect(report.results[1]?.outcome).toMatchObject({ ok: true, externalId: 'vinted-1' })
  })

  it('mode auction vers connecteur fixed-only → UNSUPPORTED_MODE sans appel', async () => {
    const fixedOnly = new FakeConnector(Marketplace.VINTED, () => success('x'), ['fixed'])
    const both = new FakeConnector(Marketplace.EBAY, () => success('ebay-1'), ['fixed', 'auction'])
    const publisher = new CoreSyncPublisher(registry(fixedOnly, both))
    const auction: UnifiedListing = {
      ...listing,
      mode: 'auction',
      prixDepart: 100,
      prixReserve: null,
      dureeJours: 7,
    }

    const report = await publisher.publishMany(auction, [Marketplace.VINTED, Marketplace.EBAY])

    expect(report.results[0]?.outcome).toMatchObject({ ok: false, code: SyncErrorCode.UNSUPPORTED_MODE })
    expect(report.results[1]?.outcome).toMatchObject({ ok: true, externalId: 'ebay-1' })
    expect(fixedOnly.calls).toBe(0)
    expect(both.calls).toBe(1)
  })

  it('échec 100% (structure Jeton Global) : aucun ok, complete false', async () => {
    const failing = new FakeConnector(Marketplace.LEBONCOIN, () =>
      Promise.resolve({ ok: false, code: SyncErrorCode.NETWORK_ERROR, detail: null, retryable: true }),
    )
    const crashing = new FakeConnector(Marketplace.VINTED, () => {
      throw new Error('down')
    })
    const publisher = new CoreSyncPublisher(registry(failing, crashing))

    const report = await publisher.publishMany(listing, [Marketplace.LEBONCOIN, Marketplace.VINTED])

    expect(report.complete).toBe(false)
    expect(report.results.every(r => !r.outcome.ok)).toBe(true)
  })

  it('zéro cible → report vide, complete false (jamais un succès)', async () => {
    const publisher = new CoreSyncPublisher(registry())
    const report = await publisher.publishMany(listing, [])
    expect(report.results).toEqual([])
    expect(report.complete).toBe(false)
  })
})

describe('connecteurs eBay / Shopify (contrat v2, clients réels Run 5)', () => {
  it('sans configuration : CREDENTIALS_MISSING sur publish/withdraw, CONNECTOR_UNAVAILABLE sur le reste', async () => {
    // env vide EXPLICITE : ne jamais dépendre du process.env de la machine.
    for (const connector of [new EbayConnector({ env: {} }), new ShopifyConnector({ env: {} })]) {
      const missing = { ok: false, code: SyncErrorCode.CREDENTIALS_MISSING, retryable: false }
      const notImplemented = { ok: false, code: SyncErrorCode.CONNECTOR_UNAVAILABLE }
      expect(await connector.publish(listing)).toMatchObject(missing)
      expect(await connector.withdraw('ext-1')).toMatchObject(missing)
      // update/checkStatus : hors périmètre v1 des clients réels.
      expect(await connector.update('ext-1', listing)).toMatchObject(notImplemented)
      expect(await connector.checkStatus('ext-1')).toMatchObject(notImplemented)
    }
  })

  it('déclarent leurs capacités : fixed seul (enchères eBay = API Trading, hors v1 / D2)', () => {
    expect(new EbayConnector({ env: {} }).capabilities.modes).toEqual(['fixed'])
    expect(new ShopifyConnector({ env: {} }).capabilities.modes).toEqual(['fixed'])
  })
})
