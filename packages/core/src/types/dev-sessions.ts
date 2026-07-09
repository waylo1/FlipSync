/**
 * Developer Control Center — Developer Sessions.
 *
 * Capacité générique de diagnostic dev, sans dépendance FlipSync (pas de
 * Listing/Wallet/Marketplace ici) : réutilisable telle quelle dans un autre
 * projet. Jamais active en production (cf. dev-sessions.service côté api).
 *
 * Extensibilité : `type` est un string libre (pas d'enum DB). Les types connus
 * ont un schéma Zod strict pour la validation à l'ingestion ; tout type inconnu
 * est accepté avec un payload libre (record) — ajouter "performance" demain ne
 * casse rien côté client existant, et ne nécessite aucune migration.
 */
import { z } from 'zod'

// ─── Payloads des types connus ──────────────────────────────────────────────

const navigationPayload = z.object({
  screen: z.string(),
  route: z.string().optional(),
})

const actionPayload = z.object({
  screen: z.string(),
  component: z.string(),
  action: z.string(),
})

const apiCallPayload = z.object({
  method: z.string(),
  url: z.string(),
  durationMs: z.number(),
  statusCode: z.number(),
  error: z.string().optional(),
})

const errorPayload = z.object({
  message: z.string(),
  stack: z.string().optional(),
  kind: z.enum(['js', 'react-native', 'promise-rejection']),
})

const consolePayload = z.object({
  level: z.enum(['error', 'warn']),
  message: z.string(),
})

const deviceInfoPayload = z.object({
  platform: z.string(),
  osVersion: z.string(),
  appVersion: z.string(),
  build: z.string(),
  orientation: z.string().optional(),
})

/**
 * Registre des types d'événements connus → schéma Zod du payload. SSOT pour la
 * validation stricte. Étendre ce registre (ex: ajouter "performance") suffit à
 * couvrir un nouveau type sans toucher au reste du système.
 */
export const DEV_EVENT_PAYLOAD_SCHEMAS = {
  navigation: navigationPayload,
  action: actionPayload,
  api_call: apiCallPayload,
  error: errorPayload,
  console: consolePayload,
  device_info: deviceInfoPayload,
} as const

export type KnownDevEventType = keyof typeof DEV_EVENT_PAYLOAD_SCHEMAS

export const DEV_EVENT_TYPES = Object.keys(DEV_EVENT_PAYLOAD_SCHEMAS) as KnownDevEventType[]

export type NavigationEventPayload = z.infer<typeof navigationPayload>
export type ActionEventPayload = z.infer<typeof actionPayload>
export type ApiCallEventPayload = z.infer<typeof apiCallPayload>
export type ErrorEventPayload = z.infer<typeof errorPayload>
export type ConsoleEventPayload = z.infer<typeof consolePayload>
export type DeviceInfoEventPayload = z.infer<typeof deviceInfoPayload>

/** Enveloppe commune à tout événement, quel que soit le type — sert à l'analyse chronologique. */
const baseEventEnvelope = z.object({
  ts: z.string(),
})

/** Événement d'un type connu — payload validé strictement (une branche par type du registre). */
const knownEventSchema = z.discriminatedUnion('type', [
  baseEventEnvelope.extend({ type: z.literal('navigation'), payload: navigationPayload }),
  baseEventEnvelope.extend({ type: z.literal('action'), payload: actionPayload }),
  baseEventEnvelope.extend({ type: z.literal('api_call'), payload: apiCallPayload }),
  baseEventEnvelope.extend({ type: z.literal('error'), payload: errorPayload }),
  baseEventEnvelope.extend({ type: z.literal('console'), payload: consolePayload }),
  baseEventEnvelope.extend({ type: z.literal('device_info'), payload: deviceInfoPayload }),
])

/** Événement d'un type inconnu (extension future) — payload libre. */
const unknownEventSchema = baseEventEnvelope.extend({
  type: z.string().refine(t => !DEV_EVENT_TYPES.includes(t as KnownDevEventType)),
  payload: z.record(z.unknown()),
})

/** Schéma d'ingestion — accepte les types connus (stricts) et inconnus (extensibles). */
export const devSessionEventSchema = z.union([knownEventSchema, unknownEventSchema])

/**
 * Union discriminée pour les types connus + fallback pour tout type futur non
 * encore modélisé côté TS. Un LLM lisant un export de session doit pouvoir
 * comprendre chaque événement sans contexte externe — d'où `ts` + `type` +
 * `payload` explicite sur toutes les branches, connues ou non.
 */
export type DevSessionEvent =
  | { type: 'navigation'; ts: string; payload: NavigationEventPayload }
  | { type: 'action'; ts: string; payload: ActionEventPayload }
  | { type: 'api_call'; ts: string; payload: ApiCallEventPayload }
  | { type: 'error'; ts: string; payload: ErrorEventPayload }
  | { type: 'console'; ts: string; payload: ConsoleEventPayload }
  | { type: 'device_info'; ts: string; payload: DeviceInfoEventPayload }
  | { type: string; ts: string; payload: Record<string, unknown> }

/** Contrat POST /dev-sessions/start. */
export interface StartDevSessionResult {
  id: string
  startedAt: string
}

/** Contrat GET /admin/dev-sessions — liste résumée. */
export interface DevSessionSummary {
  id: string
  startedAt: string
  endedAt: string | null
  platform: string | null
  eventCount: number
  errorCount: number
  apiCallCount: number
}

/**
 * Contrat GET /admin/dev-sessions/:id/export — une session doit être autonome :
 * cet objet seul doit suffire à diagnostiquer un bug (LLM ou humain), sans
 * fichier ni contexte complémentaire.
 */
export interface DevSessionDetail extends DevSessionSummary {
  events: DevSessionEvent[]
}
