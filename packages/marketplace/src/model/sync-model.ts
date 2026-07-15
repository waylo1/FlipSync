// ─── Modèle de référence FSM (INVARIANT-SPEC §1, gate P5→P8) ───────────────
// Réimplémentation minimale, EN MÉMOIRE, SANS I/O, de la sémantique SYNC-FSM
// (états §1, transitions §3, dédup A1, monotonie INV-17, vente set-once
// first-commit-wins §4). C'est l'ORACLE contre lequel les propriétés (P-12,
// P-17, P-18, P-22, ...) sont vérifiées — pas le réducteur de production
// (qui n'existe pas encore, cf. MASTER-REMED §3 étape 8 : le modèle précède
// le réducteur, le réducteur devra ÉGALER ce modèle sous tous les générateurs).
//
// INV-23 (généricité) : aucun nom de canal réel ici — `ChannelId` est un
// identifiant opaque (`C0`..`C4` côté générateurs). Toute branche est fonction
// de l'état/l'entrée, jamais d'une identité de marketplace.

export type ChannelId = string

export type ChannelState =
  | 'QUEUED'
  | 'SUBMITTED'
  | 'PUBLISHED'
  | 'RETRACTING'
  | 'SOLD'
  | 'OVERSOLD'
  | 'RETRACTED'
  | 'ENDED'
  | 'FAILED'
  | 'DIRTY'

export interface Line {
  readonly channel: ChannelId
  readonly state: ChannelState
  readonly attempts: number
  readonly epoch: number
}

export interface SaleFact {
  readonly channel: ChannelId
  readonly eventKey: string
}

export interface World {
  readonly lines: ReadonlyMap<ChannelId, Line>
  readonly sale: SaleFact | null
  readonly seenEventKeys: ReadonlySet<string>
}

/** Rang des seuls états attestés PAR LE CANAL (INVARIANT-SPEC §1). Plus haut
 *  = plus avancé, ne recule jamais. Absent = état de croyance (réalignable). */
export const TRUTH_RANK: Partial<Record<ChannelState, number>> = {
  SUBMITTED: 1,
  PUBLISHED: 2,
  SOLD: 3,
  ENDED: 3,
  RETRACTED: 3,
}

export function truthRank(state: ChannelState): number {
  return TRUTH_RANK[state] ?? 0
}

/** Terminal de vérité — absorbant, cf. INV-24. */
function isTerminalTruth(state: ChannelState): boolean {
  return state === 'SOLD' || state === 'ENDED' || state === 'RETRACTED'
}

// ─── Entrées (SYNC-FSM §2) ──────────────────────────────────────────────────
// Les 4 classes du contrat : événements canal (dédupliqués par (channel,
// eventKey) — A1), résultats d'opération, commandes, timers.

type EventKind =
  | 'PUBLISH_CONFIRMED'
  | 'PUBLISH_REJECTED'
  | 'SOLD'
  | 'RETRACT_CONFIRMED'
  | 'LISTING_ENDED'
  | 'OFFER_RECEIVED'
  | 'MESSAGE_RECEIVED'

const EVENT_KINDS: readonly EventKind[] = [
  'PUBLISH_CONFIRMED',
  'PUBLISH_REJECTED',
  'SOLD',
  'RETRACT_CONFIRMED',
  'LISTING_ENDED',
  'OFFER_RECEIVED',
  'MESSAGE_RECEIVED',
]

export type Input = { readonly channel: ChannelId } & (
  | { readonly kind: EventKind; readonly eventKey: string }
  | { readonly kind: 'OUTCOME_PUBLISHED' }
  | { readonly kind: 'OUTCOME_SUBMITTED' }
  | { readonly kind: 'OUTCOME_FAILED_TRANSIENT' }
  | { readonly kind: 'OUTCOME_FAILED_PERMANENT' }
  | { readonly kind: 'OUTCOME_RETRACT_OK' }
  | { readonly kind: 'OUTCOME_RETRACT_TRANSIENT' }
  | { readonly kind: 'OUTCOME_RETRACT_PERMANENT' }
  | { readonly kind: 'CMD_PUBLISH' }
  | { readonly kind: 'CMD_RETRACT'; readonly reason: 'SOLD_ELSEWHERE' | 'USER' | 'POLICY' }
  | { readonly kind: 'CMD_REPUBLISH' }
  | { readonly kind: 'CMD_COMPENSATE' }
  | { readonly kind: 'TIMER_TIMEOUT_SUBMITTED' }
  | { readonly kind: 'TIMER_TIMEOUT_RETRACT' }
)

function isEventInput(
  input: Input,
): input is Input & { kind: EventKind; eventKey: string } {
  return (EVENT_KINDS as readonly string[]).includes(input.kind)
}

export type Effect =
  | { readonly kind: 'RETRACT_INTENT'; readonly channel: ChannelId; readonly reason: 'SOLD_ELSEWHERE' }
  | { readonly kind: 'STALE_DROP'; readonly channel: ChannelId; readonly input: Input }
  | { readonly kind: 'INCIDENT'; readonly channel: ChannelId }
  | { readonly kind: 'DASHBOARD_EVENT'; readonly channel: ChannelId; readonly name: string }

export interface StepResult {
  readonly world: World
  readonly effects: readonly Effect[]
}

function withLine(world: World, line: Line): World {
  const lines = new Map(world.lines)
  lines.set(line.channel, line)
  return { ...world, lines }
}

function staleDrop(world: World, input: Input): StepResult {
  return { world, effects: [{ kind: 'STALE_DROP', channel: input.channel, input }] }
}

/** Vente set-once, tie-break first-commit-wins (SYNC-FSM §4). L'ordre de
 *  traitement des entrées PAR ce modèle EST l'ordre de commit — first-commit-
 *  wins émerge donc directement du fait que `step` est appelé séquentiellement. */
function arbitrateSale(world: World, line: Line, eventKey: string): StepResult {
  if (world.sale === null) {
    // Gagné : cascade RETRACT(SOLD_ELSEWHERE) sur toutes les autres lignes
    // non terminales, dans le MÊME step (INV-19 — cascade atomique).
    const effects: Effect[] = []
    const lines = new Map(world.lines)
    lines.set(line.channel, { ...line, state: 'SOLD' })
    for (const other of world.lines.values()) {
      if (other.channel === line.channel) continue
      if (isTerminalTruth(other.state)) continue
      lines.set(other.channel, { ...other, state: 'RETRACTING' })
      effects.push({ kind: 'RETRACT_INTENT', channel: other.channel, reason: 'SOLD_ELSEWHERE' })
    }
    return { world: { ...world, lines, sale: { channel: line.channel, eventKey } }, effects }
  }
  if (world.sale.channel === line.channel) {
    // Déjà gagnant sur CE canal (terminal, absorbant — INV-24).
    return { world, effects: [] }
  }
  // Perdu : vente déjà prise ailleurs → OVERSOLD + incident bruyant (INV-25).
  return {
    world: withLine(world, { ...line, state: 'OVERSOLD' }),
    effects: [
      { kind: 'INCIDENT', channel: line.channel },
      { kind: 'DASHBOARD_EVENT', channel: line.channel, name: 'OVERSOLD' },
    ],
  }
}

/** Transition d'UNE ligne pour une entrée déjà dédupliquée. Totalité (INV-22) :
 *  tout couple (état, entrée) non listé ci-dessous tombe dans le défaut
 *  STALE_DROP — jamais d'exception, jamais de cas muet (SYNC-FSM §3/§5). */
function transition(world: World, line: Line, input: Input): StepResult {
  switch (line.state) {
    case 'QUEUED':
      switch (input.kind) {
        case 'OUTCOME_FAILED_TRANSIENT':
          return { world: withLine(world, { ...line, attempts: line.attempts + 1 }), effects: [] }
        case 'OUTCOME_PUBLISHED':
          return { world: withLine(world, { ...line, state: 'PUBLISHED' }), effects: [] }
        case 'OUTCOME_SUBMITTED':
          return { world: withLine(world, { ...line, state: 'SUBMITTED' }), effects: [] }
        case 'OUTCOME_FAILED_PERMANENT':
          return { world: withLine(world, { ...line, state: 'FAILED' }), effects: [] }
        case 'CMD_RETRACT':
          return { world: withLine(world, { ...line, state: 'RETRACTED' }), effects: [] }
        default:
          return staleDrop(world, input)
      }

    case 'SUBMITTED':
      switch (input.kind) {
        case 'PUBLISH_CONFIRMED':
          return { world: withLine(world, { ...line, state: 'PUBLISHED' }), effects: [] }
        case 'PUBLISH_REJECTED':
        case 'TIMER_TIMEOUT_SUBMITTED':
          return { world: withLine(world, { ...line, state: 'FAILED' }), effects: [] }
        case 'CMD_RETRACT':
          return { world: withLine(world, { ...line, state: 'RETRACTING' }), effects: [] }
        case 'SOLD':
          return arbitrateSale(world, line, input.eventKey)
        default:
          return staleDrop(world, input)
      }

    case 'PUBLISHED':
      switch (input.kind) {
        case 'CMD_RETRACT':
          return { world: withLine(world, { ...line, state: 'RETRACTING' }), effects: [] }
        case 'SOLD':
          return arbitrateSale(world, line, input.eventKey)
        case 'LISTING_ENDED':
          return { world: withLine(world, { ...line, state: 'ENDED' }), effects: [] }
        case 'RETRACT_CONFIRMED':
          // Inattendu en PUBLISHED (aucun retrait demandé) : corrective →
          // ENDED, la vérité est le canal (INV-5, SYNC-FSM §5).
          return { world: withLine(world, { ...line, state: 'ENDED' }), effects: [] }
        default:
          return staleDrop(world, input)
      }

    case 'RETRACTING':
      switch (input.kind) {
        case 'OUTCOME_RETRACT_TRANSIENT':
          return { world: withLine(world, { ...line, attempts: line.attempts + 1 }), effects: [] }
        case 'OUTCOME_RETRACT_OK':
        case 'RETRACT_CONFIRMED':
        case 'LISTING_ENDED':
          return { world: withLine(world, { ...line, state: 'RETRACTED' }), effects: [] }
        case 'OUTCOME_RETRACT_PERMANENT':
        case 'TIMER_TIMEOUT_RETRACT':
          return { world: withLine(world, { ...line, state: 'DIRTY' }), effects: [] }
        case 'SOLD':
          return arbitrateSale(world, line, input.eventKey)
        default:
          return staleDrop(world, input)
      }

    case 'DIRTY':
      switch (input.kind) {
        case 'OUTCOME_RETRACT_OK':
        case 'RETRACT_CONFIRMED':
          return { world: withLine(world, { ...line, state: 'RETRACTED' }), effects: [] }
        case 'SOLD':
          return arbitrateSale(world, line, input.eventKey)
        default:
          return staleDrop(world, input)
      }

    case 'FAILED':
      switch (input.kind) {
        case 'CMD_REPUBLISH':
          return {
            world: withLine(world, { ...line, state: 'QUEUED', epoch: line.epoch + 1, attempts: 0 }),
            effects: [],
          }
        case 'PUBLISH_CONFIRMED':
          // Confirm tardif (corrective §5) : la vérité-canal prime sur la
          // croyance FAILED — sinon zombie non tracké.
          return { world: withLine(world, { ...line, state: 'PUBLISHED' }), effects: [] }
        default:
          return staleDrop(world, input)
      }

    case 'OVERSOLD':
      switch (input.kind) {
        case 'CMD_COMPENSATE':
          return { world: withLine(world, { ...line, state: 'RETRACTED' }), effects: [] }
        default:
          return staleDrop(world, input)
      }

    // Terminaux de vérité (INV-24) : absorbants, tout événement stale-drop.
    case 'SOLD':
    case 'ENDED':
    case 'RETRACTED':
      return staleDrop(world, input)
  }
}

/**
 * Réducteur pur : (World, Input) -> { world, effects }. Total (INV-22) —
 * ne lève jamais, journalise systématiquement le cas non prévu.
 * Dédup d'ingestion (A1/P-12) AVANT tout : un `(channel, eventKey)` déjà vu
 * est un no-op complet (aucun effect, aucune mutation), y compris quand la
 * ligne visée n'existe pas encore dans ce World.
 */
export function step(world: World, input: Input): StepResult {
  if (isEventInput(input)) {
    const key = `${input.channel}::${input.eventKey}`
    if (world.seenEventKeys.has(key)) {
      return { world, effects: [] }
    }
    const line = world.lines.get(input.channel)
    if (!line) {
      return { world, effects: [{ kind: 'STALE_DROP', channel: input.channel, input }] }
    }
    const result = transition(world, line, input)
    const seenEventKeys = new Set(result.world.seenEventKeys)
    seenEventKeys.add(key)
    return { world: { ...result.world, seenEventKeys }, effects: result.effects }
  }

  const line = world.lines.get(input.channel)
  if (!line) {
    return { world, effects: [{ kind: 'STALE_DROP', channel: input.channel, input }] }
  }
  return transition(world, line, input)
}

/** Plie `step` sur une séquence — `replay(w0, stream)` dans le vocabulaire
 *  d'INVARIANT-SPEC §3. */
export function replay(world: World, inputs: readonly Input[]): StepResult {
  let current = world
  const effects: Effect[] = []
  for (const input of inputs) {
    const result = step(current, input)
    current = result.world
    effects.push(...result.effects)
  }
  return { world: current, effects }
}

export function emptyWorld(channels: readonly ChannelId[], initial: ChannelState = 'PUBLISHED'): World {
  const lines = new Map<ChannelId, Line>()
  for (const channel of channels) {
    lines.set(channel, { channel, state: initial, attempts: 0, epoch: 0 })
  }
  return { lines, sale: null, seenEventKeys: new Set() }
}

/**
 * Projection "vérité" d'un World — ce que P-17a compare : le RANG de vérité
 * (`TRUTH_RANK`), pas l'état brut (INVARIANT-SPEC §3 : « l'état final de
 * vérité (projection sur TRUTH_RANK) »). `ENDED`/`RETRACTED`/`SOLD` partagent
 * le rang 3 : une fois un canal au rang 3, LEQUEL des trois terminaux de
 * vérité il atteint peut légitimement dépendre de l'ordre de livraison
 * (ex. `RETRACT_CONFIRMED` reçu avant vs après la cascade d'une vente sur un
 * AUTRE canal) — seul le rang (0 = croyance, 1..3 = vérité crédible) doit
 * être invariant par permutation, pas la variante exacte du terminal.
 */
export function truthProjection(world: World): ReadonlyMap<ChannelId, number> {
  const projection = new Map<ChannelId, number>()
  for (const [channel, line] of world.lines) {
    projection.set(channel, truthRank(line.state))
  }
  return projection
}
