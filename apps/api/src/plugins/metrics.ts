import fp from 'fastify-plugin'
import { FastifyPluginAsync } from 'fastify'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SystemMetrics } from '@flipsync/core'

declare module 'fastify' {
  interface FastifyInstance {
    metrics: MetricsCollector
  }
}

const WINDOW_MS = 60_000

/**
 * Collecteur de métriques process — hooké sur onResponse (chaque requête réelle),
 * pas de simulation. Rolling window de 60s pour requests/min + p50/p95 ; compteurs
 * cumulés depuis le démarrage pour requestCount/errorCount.
 */
export class MetricsCollector {
  private requestCount = 0
  private errorCount = 0
  /** Timestamps + durées des requêtes des 60 dernières secondes. */
  private recent: { ts: number; durationMs: number }[] = []
  private lastCpuUsage = process.cpuUsage()
  private lastCpuCheckMs = Date.now()

  recordRequest(statusCode: number, durationMs: number): void {
    this.requestCount++
    if (statusCode >= 500) this.errorCount++
    this.recent.push({ ts: Date.now(), durationMs })
    this.pruneOld()
  }

  private pruneOld(): void {
    const cutoff = Date.now() - WINDOW_MS
    while (this.recent.length > 0 && (this.recent[0]?.ts ?? cutoff) < cutoff) this.recent.shift()
  }

  private percentile(p: number): number {
    this.pruneOld()
    if (this.recent.length === 0) return 0
    const sorted = [...this.recent].map(r => r.durationMs).sort((a, b) => a - b)
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
    return Math.round(sorted[idx] ?? 0)
  }

  /** % CPU du process depuis le dernier appel (deltas cpuUsage/temps réel écoulé). */
  private cpuPercent(): number {
    const usage = process.cpuUsage(this.lastCpuUsage)
    const nowMs = Date.now()
    const elapsedMs = nowMs - this.lastCpuCheckMs
    this.lastCpuUsage = process.cpuUsage()
    this.lastCpuCheckMs = nowMs
    if (elapsedMs <= 0) return 0
    const usedMs = (usage.user + usage.system) / 1000
    return Math.round((usedMs / elapsedMs) * 100)
  }

  snapshot(): SystemMetrics {
    this.pruneOld()
    const mem = process.memoryUsage()
    return {
      ts: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      version: readVersion(),
      process: {
        cpuPercent: this.cpuPercent(),
        memoryUsedMb: Math.round(mem.rss / 1024 / 1024),
        memoryTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      traffic: {
        requestCount: this.requestCount,
        errorCount: this.errorCount,
        requestsPerMinute: this.recent.length,
        p50LatencyMs: this.percentile(50),
        p95LatencyMs: this.percentile(95),
      },
    }
  }
}

let cachedVersion: string | undefined
function readVersion(): string {
  if (cachedVersion) return cachedVersion
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as { version?: string }
    cachedVersion = pkg.version ?? '0.0.0'
  } catch {
    cachedVersion = '0.0.0'
  }
  return cachedVersion
}

/** Décore app.metrics et journalise chaque requête réelle via onResponse. */
const metricsPlugin: FastifyPluginAsync = async app => {
  const collector = new MetricsCollector()
  app.decorate('metrics', collector)

  app.addHook('onResponse', async (req, reply) => {
    collector.recordRequest(reply.statusCode, reply.elapsedTime)
  })
}

export default fp(metricsPlugin, { name: 'metrics-plugin' })
