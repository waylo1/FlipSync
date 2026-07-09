import { PrismaClient } from '@flipsync/db'
import type { ServiceHealth, ServiceStatus, SystemHealth } from '@flipsync/core'

/**
 * Service de santé — chaque service est PINGÉ réellement (pas de statut supposé).
 * Fonction pure (prend le client Prisma en paramètre) : testable, sans cache global.
 * Un cache TTL au niveau route pourra être ajouté plus tard sans toucher ici.
 */

/** Timeout court des pings réseau — un service lent ne doit pas bloquer /admin/health. */
const PING_TIMEOUT_MS = 1500

async function pingDatabase(db: PrismaClient): Promise<ServiceHealth> {
  const start = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    return { id: 'database', label: 'PostgreSQL', status: 'healthy', latencyMs: Date.now() - start }
  } catch {
    return { id: 'database', label: 'PostgreSQL', status: 'down', detail: 'injoignable' }
  }
}

async function pingInference(): Promise<ServiceHealth> {
  const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  const model = process.env.OLLAMA_MODEL ?? 'qwen2.5vl:3b'
  const label = `Ollama ${model}`
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/api/version`, { signal: controller.signal })
    if (!res.ok) return { id: 'inference', label, status: 'down', detail: `HTTP ${res.status}` }
    return { id: 'inference', label, status: 'healthy', latencyMs: Date.now() - start }
  } catch {
    return { id: 'inference', label, status: 'down', detail: 'injoignable' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Stripe : pas de ping live (on ne déclenche pas d'appel API à chaque poll). Statut
 * dérivé de la config, honnêtement : clé live → healthy ; clé test/placeholder →
 * warning (paiements pas sur un pied réel) ; absente → down.
 */
function checkStripe(): ServiceHealth {
  const key = process.env.STRIPE_SECRET_KEY ?? ''
  if (!key) return { id: 'stripe', label: 'Stripe', status: 'down', detail: 'clé absente' }
  if (key.startsWith('sk_live')) return { id: 'stripe', label: 'Stripe', status: 'healthy', detail: 'clé live' }
  return { id: 'stripe', label: 'Stripe', status: 'warning', detail: 'clé test' }
}

function apiService(): ServiceHealth {
  return { id: 'api', label: 'API', status: 'healthy', detail: `uptime ${Math.floor(process.uptime())}s` }
}

const MOBILE_HEALTHY_MS = 2 * 60_000
const MOBILE_WARNING_MS = 30 * 60_000

function formatSince(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `vu il y a ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `vu il y a ${m}min`
  return `vu il y a ${Math.floor(m / 60)}h`
}

/**
 * Statut "mobile" dérivé de la dernière requête authentifiée hors /admin (donc
 * forcément l'app mobile — la console admin n'appelle que /admin/*). Pas un ping :
 * une absence d'activité récente ne veut pas dire panne, juste app fermée.
 */
function checkMobile(lastSeenAt: number | null): ServiceHealth {
  if (lastSeenAt === null) return { id: 'mobile', label: 'Mobile', status: 'down', detail: 'jamais connecté' }
  const elapsed = Date.now() - lastSeenAt
  const detail = formatSince(elapsed)
  if (elapsed < MOBILE_HEALTHY_MS) return { id: 'mobile', label: 'Mobile', status: 'healthy', detail }
  if (elapsed < MOBILE_WARNING_MS) return { id: 'mobile', label: 'Mobile', status: 'warning', detail }
  return { id: 'mobile', label: 'Mobile', status: 'down', detail }
}

/**
 * Score 0–100 dérivé de l'état RÉEL. Formule (documentée, ajustable au fil des briques) :
 *   base 100
 *   − 40 si la base est down (le système ne peut pas fonctionner)
 *   − 25 si l'inférence est down (pipeline IA indisponible)
 *   −  5 si Stripe est en warning (clé de test)
 * Le terme taux d'erreur (métriques trafic) sera ajouté quand la brique metrics existera.
 */
function computeScore(services: ServiceHealth[]): number {
  const byId = new Map(services.map(s => [s.id, s]))
  let score = 100
  if (byId.get('database')?.status === 'down') score -= 40
  if (byId.get('inference')?.status === 'down') score -= 25
  if (byId.get('stripe')?.status === 'warning') score -= 5
  return Math.max(0, Math.min(100, score))
}

/**
 * overall : `down` seulement si la base est down (système non fonctionnel) ;
 * `warning` si l'inférence est down ou un service en warning (dégradé mais opérationnel) ;
 * `healthy` si tout est vert.
 */
function computeOverall(services: ServiceHealth[]): ServiceStatus {
  const byId = new Map(services.map(s => [s.id, s]))
  // "mobile" est informationnel (app fermée ≠ panne système) — exclu du calcul.
  const systemServices = services.filter(s => s.id !== 'mobile')
  if (byId.get('database')?.status === 'down') return 'down'
  if (systemServices.some(s => s.status === 'down' || s.status === 'warning')) return 'warning'
  return 'healthy'
}

/** Ping tous les services en parallèle et agrège overall + score. */
export async function checkHealth(db: PrismaClient, mobileLastSeenAt: number | null = null): Promise<SystemHealth> {
  const [database, inference] = await Promise.all([pingDatabase(db), pingInference()])
  const services: ServiceHealth[] = [apiService(), database, inference, checkStripe(), checkMobile(mobileLastSeenAt)]
  return {
    ts: new Date().toISOString(),
    overall: computeOverall(services),
    score: computeScore(services),
    services,
  }
}
