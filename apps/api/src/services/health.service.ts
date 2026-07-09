import { PrismaClient } from '@flipsync/db'
import { spawn } from 'node:child_process'
import type { ServiceHealth, ServiceRestartResult, ServiceStatus, SystemHealth } from '@flipsync/core'

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
  if (byId.get('database')?.status === 'down') return 'down'
  if (services.some(s => s.status === 'down' || s.status === 'warning')) return 'warning'
  return 'healthy'
}

/**
 * Relance Ollama en local (`ollama serve`, détaché — le process API ne l'attend pas).
 * Action volontairement limitée à Ollama : c'est le seul service ici qui tourne en
 * process local relançable. Stripe/PostgreSQL sont des services externes, pas de
 * bouton "restart" honnête possible pour eux.
 */
export function restartInference(): ServiceRestartResult {
  try {
    const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' })
    child.unref()
    child.on('error', () => {
      // process introuvable ou déjà lancé ailleurs — visible via le prochain ping health
    })
    return { started: true, detail: 'commande ollama serve envoyée' }
  } catch {
    return { started: false, detail: 'binaire ollama introuvable' }
  }
}

/** Ping tous les services en parallèle et agrège overall + score. */
export async function checkHealth(db: PrismaClient): Promise<SystemHealth> {
  const [database, inference] = await Promise.all([pingDatabase(db), pingInference()])
  const services: ServiceHealth[] = [apiService(), database, inference, checkStripe()]
  return {
    ts: new Date().toISOString(),
    overall: computeOverall(services),
    score: computeScore(services),
    services,
  }
}
