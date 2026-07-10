/**
 * Enregistreur Developer Sessions — capture automatique (dev only) vers le
 * Developer Control Center (apps/api /dev-sessions/*). Zéro couplage domaine
 * FlipSync : n'importe quel type d'événement libre (cf. packages/core
 * dev-sessions.ts) suffit à décrire ce qui se passe dans l'app.
 *
 * Une session = un passage en foreground : démarrée à l'activation de l'app,
 * flushée + arrêtée au passage en arrière-plan. Pas de bouton Start/Stop
 * manuel : l'instrumentation est automatique, c'est le seul moyen que ça
 * serve vraiment (cf. objectif productivité).
 */
import { AppState, Platform } from 'react-native'
import Constants from 'expo-constants'

// Dupliqué depuis services/api.ts (pas importé) : un import créerait un cycle
// require (api.ts -> recorder.ts -> api.ts), source de valeurs non initialisées.
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3001'

export const devSessionsEnabled = __DEV__

const FLUSH_INTERVAL_MS = 4_000
const MAX_BUFFER = 500

type RawEvent = { type: string; ts: string; payload: Record<string, unknown> }
interface ReactNativeErrorUtils {
  getGlobalHandler: () => ((error: Error, isFatal?: boolean) => void) | undefined
  setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void
}

let sessionId: string | null = null
let buffer: RawEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
let currentScreen = 'unknown'

function push(type: string, payload: Record<string, unknown>): void {
  if (!devSessionsEnabled) return
  buffer.push({ type, ts: new Date().toISOString(), payload })
  if (buffer.length >= MAX_BUFFER) void flush()
}

async function flush(): Promise<void> {
  if (!sessionId || buffer.length === 0) return
  const events = buffer
  buffer = []
  try {
    await fetch(`${API_BASE}/dev-sessions/${sessionId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: authHeader() },
      body: JSON.stringify({ events }),
    })
  } catch {
    // Best-effort : un lot perdu (coupure réseau) n'interrompt pas la capture,
    // les événements suivants continuent d'être bufferisés/envoyés.
  }
}

function authHeader(): string {
  // Import tardif pour éviter un cycle (auth.store → ... → recorder).
  const { useAuthStore } = require('../store/auth.store') as typeof import('../store/auth.store')
  return `Bearer ${useAuthStore.getState().token ?? ''}`
}

async function startSession(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/dev-sessions/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: authHeader() },
      body: JSON.stringify({ platform: Platform.OS, appVersion: Constants.expoConfig?.version ?? 'dev' }),
    })
    if (!res.ok) return
    const body = (await res.json()) as { id: string }
    sessionId = body.id
    push('device_info', {
      platform: Platform.OS,
      osVersion: String(Platform.Version),
      appVersion: Constants.expoConfig?.version ?? 'dev',
      build: String(Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? 'dev'),
    })
  } catch {
    // Pas de session dev cette fois (API injoignable) — l'app continue normalement.
  }
}

async function stopSession(): Promise<void> {
  if (!sessionId) return
  await flush()
  const id = sessionId
  sessionId = null
  try {
    await fetch(`${API_BASE}/dev-sessions/${id}/stop`, {
      method: 'POST',
      headers: { authorization: authHeader() },
    })
  } catch {
    // Le serveur considérera la session comme jamais arrêtée (endedAt null) — sans gravité en dev.
  }
}

/** À appeler une fois, à la racine de l'app (app/_layout.tsx). */
export function initDevSession(): () => void {
  if (!devSessionsEnabled) return () => {}

  void startSession()
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS)

  const sub = AppState.addEventListener('change', state => {
    if (state === 'active' && !sessionId) void startSession()
    else if (state !== 'active' && sessionId) void stopSession()
  })

  // ErrorUtils est injecté par React Native mais non typé dans globalThis.
  const errorUtils = (global as unknown as { ErrorUtils?: ReactNativeErrorUtils }).ErrorUtils
  const prevHandler = errorUtils?.getGlobalHandler?.()
  errorUtils?.setGlobalHandler?.((error: Error, isFatal?: boolean) => {
    trackError(error.message, error.stack, 'js')
    prevHandler?.(error, isFatal)
  })

  const origError = console.error
  const origWarn = console.warn
  console.error = (...args: unknown[]) => {
    trackConsole('error', args.map(String).join(' '))
    origError(...args)
  }
  console.warn = (...args: unknown[]) => {
    trackConsole('warn', args.map(String).join(' '))
    origWarn(...args)
  }

  return () => {
    console.error = origError
    console.warn = origWarn
    sub.remove()
    if (flushTimer) clearInterval(flushTimer)
    void stopSession()
  }
}

export function trackNavigation(screen: string, route?: string): void {
  currentScreen = screen
  push('navigation', route ? { screen, route } : { screen })
}

export function trackApiCall(method: string, url: string, durationMs: number, statusCode: number, error?: string): void {
  push('api_call', error ? { method, url, durationMs, statusCode, error } : { method, url, durationMs, statusCode })
}

export function trackError(message: string, stack: string | undefined, kind: 'js' | 'react-native' | 'promise-rejection'): void {
  push('error', stack ? { message, stack, kind } : { message, kind })
}

export function trackConsole(level: 'error' | 'warn', message: string): void {
  push('console', { level, message })
}

export function trackAction(screen: string, component: string, action: string): void {
  push('action', { screen, component, action })
}

/**
 * Helper à appeler aux points d'intention métier de l'app — pas d'instrumentation
 * automatique par bouton. Écran courant déduit de la dernière navigation, pas
 * besoin de le préciser à l'appel.
 *
 * dev.track('publish_button_pressed')
 * dev.track('listing_saved')
 */
export const dev = {
  track: (label: string): void => trackAction(currentScreen, 'app', label),
}
