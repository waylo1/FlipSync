import { spawn } from 'node:child_process'
import localtunnel, { Tunnel } from 'localtunnel'
import type {
  DevActionsState,
  OllamaStatus,
  RestartOllamaResult,
  TunnelActionResult,
  TunnelStatus,
} from '@flipsync/core'

/**
 * Developer Actions — panneau d'actions locales (relance Ollama, tunnel public).
 * JAMAIS actif en production : `enabled()` doit être vérifié par CHAQUE route
 * avant d'exécuter quoi que ce soit (pas seulement pour l'affichage du front).
 */
export const devActionsEnabled = (): boolean => process.env.NODE_ENV !== 'production'

const PING_TIMEOUT_MS = 1500

function log(action: string, detail: string): void {
  // Journalisation simple stdout — ces actions modifient l'environnement local,
  // elles doivent laisser une trace même sans dashboard d'events (cf. D3, reporté).
  console.log(`[dev-actions] ${action}: ${detail}`)
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  const model = process.env.OLLAMA_MODEL ?? 'qwen2.5vl:3b'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/api/version`, { signal: controller.signal })
    if (!res.ok) return { running: false, version: null, model }
    const body = (await res.json()) as { version?: string }
    return { running: true, version: body.version ?? null, model }
  } catch {
    return { running: false, version: null, model }
  } finally {
    clearTimeout(timer)
  }
}

/** Relance Ollama en local (process détaché) — binaire introuvable ou déjà lancé : sans risque. */
export function restartOllama(): RestartOllamaResult {
  try {
    const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' })
    child.unref()
    child.on('error', () => log('restart-ollama', 'process error (binaire introuvable ou déjà lancé)'))
    log('restart-ollama', 'commande ollama serve envoyée')
    return { ok: true, detail: 'commande ollama serve envoyée' }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'binaire ollama introuvable'
    log('restart-ollama', `échec: ${detail}`)
    return { ok: false, detail }
  }
}

/** Instance de tunnel unique (process API) — un dev local n'en ouvre qu'un à la fois. */
let activeTunnel: Tunnel | null = null

export function getTunnelStatus(): TunnelStatus {
  return { active: activeTunnel !== null, url: activeTunnel?.url ?? null }
}

export async function startTunnel(port: number): Promise<TunnelActionResult> {
  if (activeTunnel) {
    log('start-tunnel', 'déjà actif')
    return { ok: true, detail: 'tunnel déjà actif', tunnel: getTunnelStatus() }
  }
  try {
    const tunnel = await localtunnel({ port })
    activeTunnel = tunnel
    tunnel.on('close', () => {
      log('tunnel', 'fermé (événement close)')
      activeTunnel = null
    })
    log('start-tunnel', `ouvert sur ${tunnel.url}`)
    return { ok: true, detail: 'tunnel ouvert', tunnel: getTunnelStatus() }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'échec ouverture tunnel'
    log('start-tunnel', `échec: ${detail}`)
    return { ok: false, detail, tunnel: getTunnelStatus() }
  }
}

export async function stopTunnel(): Promise<TunnelActionResult> {
  if (!activeTunnel) {
    return { ok: true, detail: 'aucun tunnel actif', tunnel: getTunnelStatus() }
  }
  activeTunnel.close()
  activeTunnel = null
  log('stop-tunnel', 'fermé')
  return { ok: true, detail: 'tunnel fermé', tunnel: getTunnelStatus() }
}

export async function getDevActionsState(): Promise<DevActionsState> {
  const [ollama] = await Promise.all([getOllamaStatus()])
  return { enabled: devActionsEnabled(), ollama, tunnel: getTunnelStatus() }
}
