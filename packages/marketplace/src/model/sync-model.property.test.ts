// ─── Les 4 reines (INVARIANT-SPEC §8, MASTER-REMED §3 étape 8) ─────────────
// P-12 (dédup), P-17 (monotonie), P-18 (vente unique), P-22 (totalité) —
// vérifiées contre le modèle de référence (sync-model.ts), pas contre un
// réducteur de production (qui n'existe pas encore).

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  dup,
  genChannelSet,
  genEventStreamWithAtMostOneSold,
  genHostileEvent,
  genInterleavePicks,
  genSoldEvent,
  injectHostile,
  interleaveWith,
  permuteWith,
} from './generators'
import { emptyWorld, replay, truthProjection, truthRank, type Input } from './sync-model'

describe('P-12 — dédup d\'ingestion (INV-12/A1)', () => {
  it('replay(dup(stream, k)) ≡ replay(stream) pour tout k', () => {
    fc.assert(
      fc.property(
        genChannelSet,
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 0, max: 42 }),
        (channels, k, seed) => {
          const streamArb = genEventStreamWithAtMostOneSold(channels)
          const stream = fc.sample(streamArb, { numRuns: 1, seed })[0]!
          const world0 = emptyWorld(channels, 'PUBLISHED')

          const baseline = replay(world0, stream)
          const withDuplicates = replay(world0, dup(stream, k))

          // Même projection de vérité...
          expect([...truthProjection(withDuplicates.world)]).toEqual([...truthProjection(baseline.world)])
          // ...et aucun effect supplémentaire imputable aux doublons (no-op total).
          expect(withDuplicates.effects.length).toBe(baseline.effects.length)
        },
      ),
    )
  })
})

describe('P-17a — commutativité par permutation (≤1 SOLD)', () => {
  it('la projection de vérité est indépendante de l\'ordre de livraison', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 }), seed => {
        const channels = fc.sample(genChannelSet, { numRuns: 1, seed })[0]!
        const stream = fc.sample(genEventStreamWithAtMostOneSold(channels), { numRuns: 1, seed: seed + 1 })[0]!
        const order = fc.sample(
          fc.shuffledSubarray(
            stream.map((_, i) => i),
            { minLength: stream.length, maxLength: stream.length },
          ),
          { numRuns: 1, seed: seed + 2 },
        )[0]! as number[]

        const world0 = emptyWorld(channels, 'PUBLISHED')
        const original = replay(world0, stream)
        const permuted = replay(world0, permuteWith(stream, order))

        expect([...truthProjection(permuted.world)]).toEqual([...truthProjection(original.world)])
      }),
    )
  })
})

describe('P-17b — non-recul (le rang de vérité ne diminue jamais)', () => {
  it('tout événement de rang inférieur au rang courant est un stale-drop journalisé, jamais une mutation', () => {
    fc.assert(
      fc.property(genChannelSet, fc.integer({ min: 0, max: 99 }), (channels, seed) => {
        const stream = fc.sample(genEventStreamWithAtMostOneSold(channels), { numRuns: 1, seed })[0]!
        const world0 = emptyWorld(channels, 'PUBLISHED')

        let world = world0
        let previousRankByChannel = new Map(channels.map(c => [c, 0]))
        for (const input of stream) {
          const { world: next } = replay(world, [input])
          const line = next.lines.get(input.channel)
          if (line) {
            const rank = truthRank(line.state)
            const previous = previousRankByChannel.get(input.channel) ?? 0
            expect(rank).toBeGreaterThanOrEqual(previous)
            previousRankByChannel.set(input.channel, rank)
          }
          world = next
        }
      }),
    )
  })
})

describe('P-18 — vente unique', () => {
  it('∀ interleave de plusieurs SOLD, exactement un SOLD, les autres OVERSOLD', () => {
    fc.assert(
      fc.property(
        genChannelSet.filter(cs => cs.length >= 2),
        fc.integer({ min: 0, max: 99 }),
        (channels, seed) => {
          const soldStreams = channels.map((c, i) =>
            fc.sample(genSoldEvent(c), { numRuns: 1, seed: seed + i })[0]!,
          )
          // Entrelacement successif de tous les flux SOLD (un par canal).
          let merged: Input[] = [soldStreams[0]!]
          for (let i = 1; i < soldStreams.length; i++) {
            const picks = fc.sample(genInterleavePicks(merged.length, 1), { numRuns: 1, seed: seed + i })[0]!
            merged = interleaveWith(merged, [soldStreams[i]!], picks)
          }

          const world0 = emptyWorld(channels, 'PUBLISHED')
          const { world } = replay(world0, merged)

          const soldCount = [...world.lines.values()].filter(l => l.state === 'SOLD').length
          expect(soldCount).toBe(1)
          expect(world.sale).not.toBeNull()

          for (const line of world.lines.values()) {
            if (line.channel === world.sale!.channel) continue
            expect(line.state).toBe('OVERSOLD')
          }
        },
      ),
    )
  })
})

describe('P-22 — totalité', () => {
  it('step ne lève jamais, y compris sur des événements hostiles, sur tous états', () => {
    fc.assert(
      fc.property(genChannelSet, fc.integer({ min: 0, max: 99 }), (channels, seed) => {
        const base = fc.sample(genEventStreamWithAtMostOneSold(channels), { numRuns: 1, seed })[0]!
        const hostiles = fc.sample(fc.array(genHostileEvent(), { minLength: 0, maxLength: 5 }), {
          numRuns: 1,
          seed: seed + 1,
        })[0]!
        const stream = injectHostile(base, hostiles)

        const initialStates = ['QUEUED', 'SUBMITTED', 'PUBLISHED', 'RETRACTING', 'DIRTY', 'FAILED'] as const
        for (const initial of initialStates) {
          const world0 = emptyWorld(channels, initial)
          expect(() => replay(world0, stream)).not.toThrow()
        }
      }),
    )
  })
})
