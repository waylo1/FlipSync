import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { prisma, ListingStatus, TransactionType } from '@flipsync/db'
import { Marketplace } from '@flipsync/marketplace'
import type {
  AdminOverview,
  ConnectorState,
  DevActionsState,
  DevSessionDetail,
  DevSessionSummary,
  RestartOllamaResult,
  SystemHealth,
  SystemMetrics,
  TunnelActionResult,
} from '@flipsync/core'
import { checkHealth } from '../services/health.service'
import {
  devActionsEnabled,
  getDevActionsState,
  restartOllama,
  startTunnel,
  stopTunnel,
} from '../services/dev-actions.service'
import { devSessionsEnabled, getSessionDetail, listSessions } from '../services/dev-sessions.service'
import { buildExport, EXPORT_FORMATS, type ExportFormat } from '../services/dev-session-export.service'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Liste blanche d'emails admin (CSV, ex: "a@x.com,b@y.com"). Aucun rôle en
 * base — décision volontaire pour éviter une migration Prisma pour une seule
 * console interne. Vide/absent → aucun accès (fail-closed).
 */
const adminEmails = () =>
  new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean),
  )

/**
 * Garde admin : réutilise le JWT existant (payload inchangé, { sub: userId }
 * uniquement) — lookup DB de l'email plutôt que d'enrichir le token.
 */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } })
  if (!user || !adminEmails().has(user.email.toLowerCase())) {
    return reply.code(403).send({ error: 'NOT_ADMIN' })
  }
}

/** Mode mock global (cf. plugins/services.ts) — jamais actif en production. */
const marketplaceMockEnabled = () =>
  process.env.MARKETPLACE_MOCK === '1' && process.env.NODE_ENV !== 'production'

function connectorState(marketplace: Marketplace): ConnectorState {
  if (marketplaceMockEnabled()) return 'MOCK'
  const token =
    marketplace === Marketplace.VINTED
      ? process.env.VINTED_ACCESS_TOKEN
      : process.env.LEBONCOIN_ACCESS_TOKEN
  return token ? 'LIVE' : 'MISSING'
}

/**
 * Routes /admin — console de supervision interne (Mission Control).
 * Protégées par JWT (authenticate) + garde ADMIN_EMAILS (requireAdmin).
 * Lecture seule, agrégats uniquement — jamais de données nominatives.
 */
const adminRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireAdmin)

  app.get('/overview', async (): Promise<AdminOverview> => {
    const since24h = new Date(Date.now() - DAY_MS)

    const [byStatus, aiFailed24h, publishFailed24h, walletAgg24h, walletTotals] = await Promise.all([
      prisma.listing.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.listing.count({
        where: { status: ListingStatus.AI_FAILED, updatedAt: { gte: since24h } },
      }),
      prisma.listing.count({
        where: { status: ListingStatus.PUBLISH_FAILED, updatedAt: { gte: since24h } },
      }),
      prisma.walletTransaction.groupBy({
        by: ['type'],
        _sum: { amount: true },
        where: { createdAt: { gte: since24h } },
      }),
      prisma.userWallet.aggregate({ _sum: { balance: true } }),
    ])

    const statusCounts = Object.fromEntries(
      Object.values(ListingStatus).map(status => [status, 0]),
    ) as Record<ListingStatus, number>
    for (const row of byStatus) statusCounts[row.status] = row._count._all

    const total = Object.values(statusCounts).reduce((sum, n) => sum + n, 0)

    const sumByType = (type: TransactionType) =>
      walletAgg24h.find(row => row.type === type)?._sum.amount ?? 0

    return {
      health: { status: 'ok' as const, ts: new Date().toISOString() },
      listings: { byStatus: statusCounts, total },
      ai: {
        processing: statusCounts[ListingStatus.AI_PROCESSING],
        failed24h: aiFailed24h,
      },
      marketplace: {
        vinted: connectorState(Marketplace.VINTED),
        leboncoin: connectorState(Marketplace.LEBONCOIN),
        publishFailed24h,
      },
      wallet: {
        totalBalance: walletTotals._sum.balance ?? 0, // centimes
        debited24h: sumByType(TransactionType.DEBIT), // centimes
        refunded24h: sumByType(TransactionType.REFUND), // centimes
      },
    }
  })

  /**
   * État réel des dépendances (pings live DB + Ollama + config Stripe) + score.
   * Aucun statut supposé : chaque service est mesuré au moment de l'appel.
   */
  app.get('/health', async (): Promise<SystemHealth> => checkHealth(prisma, app.mobileActivity.lastSeenAt))

  /** Métriques process réelles (CPU/RAM/uptime/trafic) — cf. plugins/metrics.ts. */
  app.get('/metrics', async (): Promise<SystemMetrics> => app.metrics.snapshot())

  /**
   * Developer Actions — section réservée au dev local (jamais en production).
   * Chaque route POST revérifie `devActionsEnabled()` elle-même (pas seulement au
   * niveau du front) : un token admin volé ne doit pas pouvoir exécuter de commande
   * shell sur une instance de production.
   */
  app.get('/actions/status', async (): Promise<DevActionsState> => getDevActionsState())

  app.post('/actions/restart-ollama', async (_req, reply): Promise<RestartOllamaResult> => {
    if (!devActionsEnabled()) return reply.code(403).send({ ok: false, detail: 'DEV_ACTIONS_DISABLED' })
    const result = restartOllama()
    if (!result.ok) return reply.code(502).send(result)
    return result
  })

  app.post('/actions/start-tunnel', async (_req, reply): Promise<TunnelActionResult> => {
    if (!devActionsEnabled()) {
      return reply
        .code(403)
        .send({ ok: false, detail: 'DEV_ACTIONS_DISABLED', tunnel: { active: false, url: null } })
    }
    const port = Number(process.env.API_PORT ?? 3001)
    const result = await startTunnel(port)
    if (!result.ok) return reply.code(502).send(result)
    return result
  })

  app.post('/actions/stop-tunnel', async (_req, reply): Promise<TunnelActionResult> => {
    if (!devActionsEnabled()) {
      return reply
        .code(403)
        .send({ ok: false, detail: 'DEV_ACTIONS_DISABLED', tunnel: { active: false, url: null } })
    }
    return stopTunnel()
  })

  /**
   * Developer Sessions — lecture seule côté admin (l'ingestion vient du mobile,
   * cf. routes/dev-sessions.ts). Désactivé en production comme tout le
   * Developer Control Center.
   */
  app.get('/dev-sessions', async (_req, reply): Promise<DevSessionSummary[]> => {
    if (!devSessionsEnabled()) return reply.code(403).send([])
    return listSessions()
  })

  app.get<{ Params: { id: string } }>('/dev-sessions/:id', async (req, reply): Promise<DevSessionDetail> => {
    if (!devSessionsEnabled()) return reply.code(403).send({ error: 'DEV_SESSIONS_DISABLED' })
    const detail = await getSessionDetail(req.params.id)
    if (!detail) return reply.code(404).send({ error: 'DEV_SESSION_NOT_FOUND' })
    return detail
  })

  /**
   * Exports autonomes — events.json (brut), report.md (lecture humaine),
   * llm-context.json / llm-prompt.md (contexte factuel prêt à coller dans un LLM).
   * Aucune IA impliquée dans la génération : gabarits fixes sur données mesurées.
   */
  app.get<{ Params: { id: string; format: string } }>(
    '/dev-sessions/:id/export/:format',
    async (req, reply) => {
      if (!devSessionsEnabled()) return reply.code(403).send({ error: 'DEV_SESSIONS_DISABLED' })
      if (!EXPORT_FORMATS.includes(req.params.format as ExportFormat)) {
        return reply.code(400).send({ error: 'INVALID_EXPORT_FORMAT' })
      }
      const detail = await getSessionDetail(req.params.id)
      if (!detail) return reply.code(404).send({ error: 'DEV_SESSION_NOT_FOUND' })

      const file = buildExport(detail, req.params.format as ExportFormat)
      reply.header('content-type', file.contentType)
      reply.header('content-disposition', `attachment; filename="${file.filename}"`)
      return file.body
    },
  )
}

export default adminRoutes
