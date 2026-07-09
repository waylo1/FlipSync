/**
 * Developer Control Center — Developer Sessions.
 *
 * Capacité générique de diagnostic dev, sans dépendance FlipSync (pas de
 * Listing/Wallet/Marketplace ici) : réutilisable telle quelle dans un autre
 * projet. Jamais active en production (cf. dev-sessions.service côté api).
 */

// DevEventType — GÉNÉRÉ depuis schema.prisma (cf. src/generated/enums.ts), ré-exporté par index.ts.

export interface NavigationEventPayload {
  screen: string
  route?: string
}

export interface ActionEventPayload {
  screen: string
  component: string
  action: string
}

export interface ApiCallEventPayload {
  method: string
  url: string
  durationMs: number
  statusCode: number
  error?: string
}

export interface ErrorEventPayload {
  message: string
  stack?: string
  kind: 'js' | 'react-native' | 'promise-rejection'
}

export interface ConsoleEventPayload {
  level: 'error' | 'warn'
  message: string
}

export interface DeviceInfoEventPayload {
  platform: string
  osVersion: string
  appVersion: string
  build: string
  orientation?: string
}

/** Union discriminée — `payload` dépend de `type`. */
export type DevSessionEvent =
  | { type: 'navigation'; ts: string; payload: NavigationEventPayload }
  | { type: 'action'; ts: string; payload: ActionEventPayload }
  | { type: 'api_call'; ts: string; payload: ApiCallEventPayload }
  | { type: 'error'; ts: string; payload: ErrorEventPayload }
  | { type: 'console'; ts: string; payload: ConsoleEventPayload }
  | { type: 'device_info'; ts: string; payload: DeviceInfoEventPayload }

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

/** Contrat GET /admin/dev-sessions/:id — timeline complète. */
export interface DevSessionDetail extends DevSessionSummary {
  events: DevSessionEvent[]
}
