import { afterEach, describe, expect, it, vi } from 'vitest'
import { ItemCondition, SyncErrorCode, type FixedPriceListing } from '@flipsync/core'
import { VintedConnector } from './vinted'
import type { PartnerCredentialResolution, PartnerPublishResult } from './partner-credentials'

const LISTING: FixedPriceListing = {
  mode: 'fixed',
  listingId: 'lst_1',
  titre: 'Lampe opaline vintage',
  description: 'Verre opalin, années 70, très bon état.',
  etat: ItemCondition.tres_bon,
  devise: 'EUR',
  marque: 'Luxo',
  categorie: 'Décoration',
  prix: 3000,
  photos: [{ url: 'https://api.flipsync.fr/uploads/a.jpg', order: 0 }],
}

const REF = (externalId: string) => ({ externalId })

const okCredentials = (): PartnerCredentialResolution => ({
  ok: true,
  credentials: { accessToken: 'tok-vinted' },
})

const missingCredentials = (): PartnerCredentialResolution => ({ ok: false, reason: 'MISSING' })

describe('VintedConnector — port ChannelConnector (C3.6, natif)', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('capacités déclarées — MP direct, pas de négociation, sync, prix fixe uniquement', () => {
    const connector = new VintedConnector({ resolveCredentials: okCredentials })
    expect(connector.capabilities).toMatchObject({
      kind: 'MP',
      transport: 'direct',
      negotiation: 'NONE',
      publishMode: 'SYNC',
    })
  })

  it('precheck : mode auction → inéligible', () => {
    const connector = new VintedConnector({ resolveCredentials: okCredentials })
    const auction = { ...LISTING, mode: 'auction' as const, prixDepart: 1000, prixReserve: null, dureeJours: 7 }
    expect(connector.precheck(auction, undefined).eligible).toBe(false)
  })

  it('precheck : mode fixed → éligible même sans credentials (credentials = échec publish(), pas précheck)', () => {
    const connector = new VintedConnector({ resolveCredentials: missingCredentials })
    expect(connector.precheck(LISTING, undefined)).toEqual({ eligible: true })
  })

  it('credentials manquants → CREDENTIALS_MISSING, zéro appel réseau, onResult notifié', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
    const onResult = vi.fn()
    const connector = new VintedConnector({ resolveCredentials: missingCredentials, onResult })

    const outcome = await connector.publish(LISTING, undefined)
    expect(outcome).toMatchObject({ status: 'FAILED', code: SyncErrorCode.CREDENTIALS_MISSING })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(onResult).toHaveBeenCalledWith({ ok: false, code: expect.stringContaining('MISSING') })
  })

  it('publish → POST /v1/items, externalId + url de la réponse partenaire', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'vinted-42', url: 'https://vinted.fr/items/42' }),
    }))
    global.fetch = fetchSpy as unknown as typeof fetch
    const onResult = vi.fn()
    const connector = new VintedConnector({ resolveCredentials: okCredentials, onResult })

    const outcome = await connector.publish(LISTING, undefined)
    expect(outcome).toEqual({ status: 'PUBLISHED', externalId: 'vinted-42', url: 'https://vinted.fr/items/42' })
    expect(onResult).toHaveBeenCalledWith({ ok: true, externalId: 'vinted-42', url: 'https://vinted.fr/items/42' })

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok-vinted' })
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({ title: LISTING.titre, price: 30, currency: 'EUR' })
  })

  it('mode auction → UNSUPPORTED_MODE (défense en profondeur), zéro appel réseau', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
    const connector = new VintedConnector({ resolveCredentials: okCredentials })

    const outcome = await connector.publish(
      { ...LISTING, mode: 'auction', prixDepart: 1000, prixReserve: null, dureeJours: 7 },
      undefined,
    )
    expect(outcome).toMatchObject({ status: 'FAILED', code: SyncErrorCode.UNSUPPORTED_MODE })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('HTTP non-ok → REMOTE_REJECTED, onResult reçoit le code brut VINTED_HTTP_xxx', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch
    const onResult = vi.fn<(result: PartnerPublishResult) => void>()
    const connector = new VintedConnector({ resolveCredentials: okCredentials, onResult })

    const outcome = await connector.publish(LISTING, undefined)
    expect(outcome).toMatchObject({ status: 'FAILED', code: SyncErrorCode.REMOTE_REJECTED })
    expect(onResult).toHaveBeenCalledWith({ ok: false, code: 'VINTED_HTTP_401' })
  })

  it('exception transport → NETWORK_ERROR (retryable), jamais levé', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    const connector = new VintedConnector({ resolveCredentials: okCredentials })

    expect(await connector.publish(LISTING, undefined)).toMatchObject({
      status: 'FAILED',
      kind: 'TRANSIENT',
      code: SyncErrorCode.NETWORK_ERROR,
    })
  })

  it('update / retract → CONNECTOR_UNAVAILABLE (v1 : publish seul)', async () => {
    const connector = new VintedConnector({ resolveCredentials: okCredentials })
    expect(await connector.update(REF('vinted-42'), LISTING, undefined)).toMatchObject({
      ok: false,
      code: SyncErrorCode.CONNECTOR_UNAVAILABLE,
    })
    expect(await connector.retract(REF('vinted-42'), undefined, 'SOLD_ELSEWHERE')).toMatchObject({
      ok: false,
      code: SyncErrorCode.CONNECTOR_UNAVAILABLE,
    })
  })

  it('parseEvent : aucun webhook câblé sur ce port → null', () => {
    const connector = new VintedConnector({ resolveCredentials: okCredentials })
    expect(connector.parseEvent({ anything: true })).toBeNull()
  })
})
