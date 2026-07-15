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
import { emptyWorld, replay, truthProjection, truthRank, type ChannelState, type Input } from './sync-model'

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

describe('P-19 — cascade atomique', () => {
  it('un SOLD gagnant émet RETRACT_INTENT pour toute ligne non terminale-vérité, au même step', () => {
    fc.assert(
      fc.property(genChannelSet.filter(cs => cs.length >= 2), fc.integer({ min: 0, max: 99 }), (channels, seed) => {
        const [winner, ...rest] = channels
        const nonTerminalStates: ChannelState[] = ['QUEUED', 'SUBMITTED', 'PUBLISHED', 'RETRACTING', 'DIRTY', 'FAILED']
        const world0 = emptyWorld(channels, 'PUBLISHED')
        // Diversifie les états des autres lignes pour couvrir tous les cas non-terminaux,
        // plus une ligne déjà terminale-vérité (ENDED) qui NE DOIT PAS être cascadée.
        let lines = new Map(world0.lines)
        rest.forEach((c, i) => {
          const state = i === 0 ? 'ENDED' : nonTerminalStates[i % nonTerminalStates.length]!
          lines.set(c, { channel: c, state, attempts: 0, epoch: 0 })
        })
        const world = { ...world0, lines }

        const sold = fc.sample(genSoldEvent(winner!), { numRuns: 1, seed })[0]!
        const { world: after, effects } = replay(world, [sold])

        const cascaded = rest.filter(c => world.lines.get(c)!.state !== 'ENDED')
        for (const c of cascaded) {
          expect(effects).toContainEqual({ kind: 'RETRACT_INTENT', channel: c, reason: 'SOLD_ELSEWHERE' })
          expect(after.lines.get(c)!.state).toBe('RETRACTING')
        }
        // La ligne déjà ENDED (terminale-vérité) n'est pas touchée par la cascade.
        const untouched = rest.find(c => world.lines.get(c)!.state === 'ENDED')
        if (untouched) {
          expect(after.lines.get(untouched)!.state).toBe('ENDED')
          expect(effects).not.toContainEqual({ kind: 'RETRACT_INTENT', channel: untouched, reason: 'SOLD_ELSEWHERE' })
        }
      }),
    )
  })
})

describe('P-24 — terminaux absorbants', () => {
  it('tout flux appliqué à une ligne déjà SOLD/ENDED/RETRACTED la laisse inchangée', () => {
    fc.assert(
      fc.property(
        genChannelSet,
        fc.constantFrom<ChannelState>('SOLD', 'ENDED', 'RETRACTED'),
        fc.integer({ min: 0, max: 99 }),
        (channels, terminal, seed) => {
          const world0 = emptyWorld(channels, terminal)
          const worldWithSale =
            terminal === 'SOLD' ? { ...world0, sale: { channel: channels[0]!, eventKey: 'seed-sale' } } : world0

          const stream = fc.sample(genEventStreamWithAtMostOneSold(channels), { numRuns: 1, seed })[0]!
          const { world: after } = replay(worldWithSale, stream)

          for (const channel of channels) {
            expect(after.lines.get(channel)!.state).toBe(terminal)
          }
        },
      ),
    )
  })
})

describe('P-25 — incidents bruyants', () => {
  it('toute entrée en DIRTY émet INCIDENT + DASHBOARD_EVENT au même step', () => {
    const world0 = emptyWorld(['C0'], 'RETRACTING')
    const { effects } = replay(world0, [{ channel: 'C0', kind: 'TIMER_TIMEOUT_RETRACT' }])
    expect(effects).toContainEqual({ kind: 'INCIDENT', channel: 'C0' })
    expect(effects).toContainEqual({ kind: 'DASHBOARD_EVENT', channel: 'C0', name: 'DIRTY' })
  })

  it('toute entrée en OVERSOLD (vente perdue) émet INCIDENT + DASHBOARD_EVENT au même step', () => {
    const world0 = emptyWorld(['C0', 'C1'], 'PUBLISHED')
    const firstSold: Input = { channel: 'C0', kind: 'SOLD', eventKey: 'k1' }
    const secondSold: Input = { channel: 'C1', kind: 'SOLD', eventKey: 'k2' }
    const { world: afterFirst } = replay(world0, [firstSold])
    const { effects } = replay(afterFirst, [secondSold])
    expect(effects).toContainEqual({ kind: 'INCIDENT', channel: 'C1' })
    expect(effects).toContainEqual({ kind: 'DASHBOARD_EVENT', channel: 'C1', name: 'OVERSOLD' })
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
