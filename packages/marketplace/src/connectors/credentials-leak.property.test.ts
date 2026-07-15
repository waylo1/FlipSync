// ─── P-15 — non-fuite de credentials (INVARIANT-SPEC §7) ───────────────────
// Scan token-like : ∀ scénario réseau (succès, HTTP KO, exception transport,
// credentials manquants), le token injecté ne doit apparaître dans AUCUNE
// sortie observable du connecteur (PublishOutcome, appel onResult) — seul
// l'en-tête Authorization envoyé AU CANAL lui-même peut le contenir.

import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ItemCondition, type FixedPriceListing } from '@flipsync/core'
import { LeboncoinConnector } from './leboncoin'
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

/** Jeton haute-entropie plausible (JWT-like / clé API) — jamais un motif trivial. */
const genToken = fc.hexaString({ minLength: 24, maxLength: 64 }).map(s => `tok_${s}`)

type NetworkScenario =
  | { kind: 'MISSING_CREDS' }
  | { kind: 'NETWORK_ERROR' }
  | { kind: 'HTTP_KO'; status: number }
  | { kind: 'SUCCESS'; externalId: string; url: string }

const genScenario: fc.Arbitrary<NetworkScenario> = fc.oneof(
  fc.constant<NetworkScenario>({ kind: 'MISSING_CREDS' }),
  fc.constant<NetworkScenario>({ kind: 'NETWORK_ERROR' }),
  fc.integer({ min: 400, max: 599 }).map(status => ({ kind: 'HTTP_KO' as const, status })),
  fc.tuple(fc.string(), fc.webUrl()).map(([id, url]) => ({ kind: 'SUCCESS' as const, externalId: id, url })),
)

function stubFetch(scenario: NetworkScenario): typeof fetch {
  return vi.fn(async () => {
    if (scenario.kind === 'NETWORK_ERROR') throw new Error('ECONNRESET')
    if (scenario.kind === 'HTTP_KO') return { ok: false, status: scenario.status }
    return {
      ok: true,
      json: async () => ({ ad_id: scenario.externalId, id: scenario.externalId, url: scenario.url }),
    }
  }) as unknown as typeof fetch
}

/** Sérialise toute sortie observable en une seule chaîne à scanner. */
function serializeObservables(outcome: unknown, onResultCalls: readonly PartnerPublishResult[]): string {
  return JSON.stringify({ outcome, onResultCalls })
}

describe.each([
  ['LeboncoinConnector', LeboncoinConnector],
  ['VintedConnector', VintedConnector],
] as const)('P-15 — %s ne fuite jamais le token', (_name, ConnectorClass) => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('aucune sortie observable ne contient le token, quel que soit le scénario réseau', () => {
    fc.assert(
      fc.asyncProperty(genToken, genScenario, async (token, scenario) => {
        global.fetch = stubFetch(scenario)
        const resolveCredentials = (): PartnerCredentialResolution =>
          scenario.kind === 'MISSING_CREDS'
            ? { ok: false, reason: 'EXPIRED' }
            : { ok: true, credentials: { accessToken: token, sellerId: 'seller-1' } }

        const onResultCalls: PartnerPublishResult[] = []
        const connector = new ConnectorClass({
          resolveCredentials,
          onResult: r => onResultCalls.push(r),
        })

        const outcome = await connector.publish(LISTING, undefined)
        const serialized = serializeObservables(outcome, onResultCalls)

        expect(serialized).not.toContain(token)
      }),
      { numRuns: 30 },
    )
  })
})
