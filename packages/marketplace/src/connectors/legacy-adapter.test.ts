import { describe, expect, it, vi } from 'vitest'
import {
  ItemCondition,
  Marketplace,
  SyncErrorCode,
  type FixedPriceListing,
} from '@flipsync/core'
import { LegacyConnectorAdapter } from './legacy-adapter'
import type { ListingPayload, MarketplaceCredentials, PublishResult } from '../types'

const listing: FixedPriceListing = {
  mode: 'fixed',
  listingId: 'lst_1',
  titre: 'Lampe opaline vintage',
  description: 'Verre opalin, années 70.',
  etat: ItemCondition.tres_bon,
  devise: 'EUR',
  marque: null,
  categorie: 'Décoration',
  prix: 3000,
  photos: [{ url: 'https://api.flipsync.fr/uploads/p1.jpg', order: 0 }],
}

const credentials: MarketplaceCredentials = {
  marketplace: Marketplace.VINTED,
  accessToken: 'tok',
}

const toPayload = (l: FixedPriceListing): ListingPayload => ({
  titre: l.titre,
  description: l.description,
  categorie: 'Maison > Luminaires', // catégorie PLATEFORME injectée par l'appelant
  etat: l.etat,
  marque: l.marque,
  prixCents: l.prix,
  photoUrls: l.photos.map(p => p.url),
})

const adapter = (
  publishV1: (p: ListingPayload, c: MarketplaceCredentials) => Promise<PublishResult>,
  opts?: { resolveOk?: boolean; onResult?: (r: PublishResult) => void },
) =>
  new LegacyConnectorAdapter(Marketplace.VINTED, {
    resolveCredentials: () =>
      opts?.resolveOk === false ? { ok: false, reason: 'MISSING' } : { ok: true, credentials },
    toPayload,
    publishV1,
    onResult: opts?.onResult,
  })

describe('LegacyConnectorAdapter', () => {
  it('credentials manquants → CREDENTIALS_MISSING sans appel v1', async () => {
    const publishV1 = vi.fn()
    const outcome = await adapter(publishV1, { resolveOk: false }).publish(listing)
    expect(outcome).toMatchObject({ ok: false, code: SyncErrorCode.CREDENTIALS_MISSING })
    expect(publishV1).not.toHaveBeenCalled()
  })

  it('succès v1 → SyncSuccess (externalId + url) avec le payload plateforme, onResult notifié', async () => {
    const onResult = vi.fn()
    const publishV1 = vi.fn(async (p: ListingPayload) => {
      expect(p.categorie).toBe('Maison > Luminaires')
      expect(p.prixCents).toBe(3000)
      return { ok: true, externalId: 'vinted-42', url: 'https://vinted.fr/items/42' } as PublishResult
    })
    const outcome = await adapter(publishV1, { onResult }).publish(listing)
    expect(outcome).toEqual({ ok: true, externalId: 'vinted-42', url: 'https://vinted.fr/items/42' })
    expect(onResult).toHaveBeenCalledWith({ ok: true, externalId: 'vinted-42', url: 'https://vinted.fr/items/42' })
  })

  it('échec v1 → code normalisé + detail = code brut (VINTED_HTTP_401 → REMOTE_REJECTED)', async () => {
    const onResult = vi.fn()
    const outcome = await adapter(async () => ({ ok: false, code: 'VINTED_HTTP_401' }), { onResult }).publish(listing)
    expect(outcome).toEqual({
      ok: false,
      code: SyncErrorCode.REMOTE_REJECTED,
      detail: 'VINTED_HTTP_401',
      retryable: false,
    })
    expect(onResult).toHaveBeenCalledWith({ ok: false, code: 'VINTED_HTTP_401' })
  })

  it('codes réseau/rate-limit v1 → retryable true', async () => {
    const network = await adapter(async () => ({ ok: false, code: 'VINTED_NETWORK_ERROR' })).publish(listing)
    expect(network).toMatchObject({ ok: false, code: SyncErrorCode.NETWORK_ERROR, retryable: true })
    const rate = await adapter(async () => ({ ok: false, code: 'VINTED_RATE_LIMITED' })).publish(listing)
    expect(rate).toMatchObject({ ok: false, code: SyncErrorCode.RATE_LIMITED, retryable: true })
  })

  it('update / withdraw / checkStatus → CONNECTOR_UNAVAILABLE (v1 = publish seul)', async () => {
    const a = adapter(async () => ({ ok: false, code: 'X' }))
    const expected = { ok: false, code: SyncErrorCode.CONNECTOR_UNAVAILABLE }
    expect(await a.update('e1', listing)).toMatchObject(expected)
    expect(await a.withdraw('e1')).toMatchObject(expected)
    expect(await a.checkStatus('e1')).toMatchObject(expected)
  })
})
