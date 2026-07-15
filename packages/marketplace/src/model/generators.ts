// ─── Générateurs (INVARIANT-SPEC §2) ───────────────────────────────────────
// Pool de canaux ANONYME (C0..C4) — jamais un nom réel (INV-23) : un test qui
// nommerait un canal ne compilerait pas contre ce pool. Combinateurs (dup,
// permute, interleave, injectHostile) = transformations pures sur un flux déjà
// généré, appliquées à l'intérieur des propriétés fast-check.

import fc from 'fast-check'
import type { ChannelId, Input } from './sync-model'

export const CHANNEL_POOL: readonly ChannelId[] = ['C0', 'C1', 'C2', 'C3', 'C4']

export const genChannelSet: fc.Arbitrary<readonly ChannelId[]> = fc.uniqueArray(
  fc.constantFrom(...CHANNEL_POOL),
  { minLength: 1, maxLength: CHANNEL_POOL.length },
)

const NON_SOLD_EVENT_KINDS = [
  'PUBLISH_CONFIRMED',
  'PUBLISH_REJECTED',
  'RETRACT_CONFIRMED',
  'LISTING_ENDED',
  'OFFER_RECEIVED',
  'MESSAGE_RECEIVED',
] as const

/** Un événement canal non-SOLD sur un canal donné, clé unique par appel. */
export function genNonSoldEvent(channel: ChannelId): fc.Arbitrary<Input> {
  return fc.record({
    channel: fc.constant(channel),
    kind: fc.constantFrom(...NON_SOLD_EVENT_KINDS),
    eventKey: fc.uuid(),
  })
}

export function genSoldEvent(channel: ChannelId): fc.Arbitrary<Input> {
  return fc.record({
    channel: fc.constant(channel),
    kind: fc.constant('SOLD' as const),
    eventKey: fc.uuid(),
  })
}

/** Flux d'événements cohérent : N événements non-SOLD répartis sur les canaux
 *  fournis, ZÉRO SOLD — sert de base à P-17a (filtré ≤1 SOLD) et P-22. */
export function genEventStream(channels: readonly ChannelId[]): fc.Arbitrary<Input[]> {
  if (channels.length === 0) return fc.constant([])
  return fc.array(fc.constantFrom(...channels), { minLength: 0, maxLength: 12 }).chain(picks =>
    fc.tuple(...picks.map(genNonSoldEvent)),
  ) as fc.Arbitrary<Input[]>
}

/**
 * Même flux, avec AU PLUS un SOLD ajouté sur un canal tiré au hasard —
 * générateur dédié à P-17a (INVARIANT-SPEC §3 : "≤1 SOLD toutes lignes
 * confondues"). Le canal choisi pour le SOLD ne reçoit AUCUN autre
 * événement du flux de base : un SOLD livré sur un canal ayant déjà atteint
 * un terminal de vérité PAR UNE AUTRE VOIE (ex. `RETRACT_CONFIRMED` inattendu
 * → `ENDED`) est une zone explicitement non tranchée (MASTER-REMED Q10,
 * ERRATA E-5 : "P-18 en dépend") — P-17a ne doit pas exercer une ambiguïté
 * non résolue, seulement la commutativité du reste du flux + le timing de
 * la cascade déclenchée par le SOLD sur les AUTRES canaux.
 */
export function genEventStreamWithAtMostOneSold(
  channels: readonly ChannelId[],
): fc.Arbitrary<Input[]> {
  return fc.tuple(fc.boolean(), fc.constantFrom(...channels)).chain(([withSold, soldChannel]) => {
    const others = withSold ? channels.filter(c => c !== soldChannel) : channels
    return fc.tuple(genEventStream(others), withSold ? genSoldEvent(soldChannel) : fc.constant(null)).map(
      ([base, sold]) => (sold ? [...base, sold] : base),
    )
  })
}

/** Rejoue des éléments déjà présents dans le flux `k` fois (mêmes `eventKey`) —
 *  combinateur `dup` (INV-12, doublons). */
export function dup(stream: readonly Input[], k: number): Input[] {
  if (stream.length === 0) return [...stream]
  const out = [...stream]
  for (let i = 0; i < k; i++) {
    out.push(stream[i % stream.length]!)
  }
  return out
}

/** Permute l'ordre de livraison en préservant les `eventKey` — combinateur
 *  `permute` (INV-17, hors-ordre). Déterministe via une seed fournie par
 *  l'appelant (fast-check `fc.shuffledSubarray` en amont, cf. tests). */
export function permuteWith(stream: readonly Input[], order: readonly number[]): Input[] {
  return order.map(i => stream[i]!)
}

/** Entrelace deux flux indépendants en préservant l'ordre relatif interne à
 *  chacun — combinateur `interleave` (INV-18/21, concurrence). `picks` est un
 *  tableau de booléens (true = prochain élément vient de `a`) de longueur
 *  `a.length + b.length` avec exactement `a.length` `true`. */
export function interleaveWith(a: readonly Input[], b: readonly Input[], picks: readonly boolean[]): Input[] {
  const out: Input[] = []
  let ia = 0
  let ib = 0
  for (const pickA of picks) {
    if (pickA && ia < a.length) out.push(a[ia++]!)
    else if (ib < b.length) out.push(b[ib++]!)
    else if (ia < a.length) out.push(a[ia++]!)
  }
  while (ia < a.length) out.push(a[ia++]!)
  while (ib < b.length) out.push(b[ib++]!)
  return out
}

/** Génère un ordre d'entrelacement valide pour `interleaveWith` (fast-check). */
export function genInterleavePicks(lenA: number, lenB: number): fc.Arbitrary<boolean[]> {
  const base = [...Array(lenA).fill(true), ...Array(lenB).fill(false)]
  return fc.shuffledSubarray(base, { minLength: base.length, maxLength: base.length }) as fc.Arbitrary<
    boolean[]
  >
}

/** Événements hostiles : canal non corrélé (hors du World), `eventKey` vide —
 *  combinateur `injectHostile` (INV-13/14, T12/T13). Ne doivent jamais faire
 *  planter `step` (P-22) ; ils tombent en STALE_DROP faute de ligne connue. */
export function genHostileEvent(): fc.Arbitrary<Input> {
  return fc.record({
    channel: fc.constant('C_UNKNOWN'),
    kind: fc.constantFrom(...NON_SOLD_EVENT_KINDS, 'SOLD' as const),
    eventKey: fc.oneof(fc.uuid(), fc.constant('')),
  })
}

export function injectHostile(stream: readonly Input[], hostiles: readonly Input[]): Input[] {
  return [...stream, ...hostiles]
}
