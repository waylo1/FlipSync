import { prisma, Prisma } from '@flipsync/db'
import {
  devSessionEventSchema,
  type DevSessionDetail,
  type DevSessionEvent,
  type DevSessionSummary,
  type StartDevSessionResult,
} from '@flipsync/core'

/**
 * Developer Control Center — jamais actif en production. Même garde que
 * Developer Actions : capacité de diagnostic dev, aucune trace en prod.
 */
export const devSessionsEnabled = (): boolean => process.env.NODE_ENV !== 'production'

export async function startSession(platform?: string, appVersion?: string): Promise<StartDevSessionResult> {
  const session = await prisma.devSession.create({ data: { platform, appVersion } })
  return { id: session.id, startedAt: session.startedAt.toISOString() }
}

/** Idempotent : réappeler stop sur une session déjà arrêtée ne fait rien de plus. */
export async function stopSession(id: string): Promise<{ ok: boolean }> {
  const session = await prisma.devSession.findUnique({ where: { id }, select: { endedAt: true } })
  if (!session) return { ok: false }
  if (!session.endedAt) {
    await prisma.devSession.update({ where: { id }, data: { endedAt: new Date() } })
  }
  return { ok: true }
}

export interface IngestResult {
  ok: boolean
  accepted: number
  rejected: number
}

/**
 * Valide chaque événement (registre Zod, cf. packages/core) avant insertion —
 * les événements invalides sont comptés mais n'empêchent pas les autres
 * d'être enregistrés (un batch mobile ne doit jamais échouer en bloc).
 */
export async function ingestEvents(sessionId: string, rawEvents: unknown[]): Promise<IngestResult> {
  const session = await prisma.devSession.findUnique({ where: { id: sessionId }, select: { id: true } })
  if (!session) return { ok: false, accepted: 0, rejected: rawEvents.length }

  const valid: DevSessionEvent[] = []
  let rejected = 0
  for (const raw of rawEvents) {
    const parsed = devSessionEventSchema.safeParse(raw)
    if (parsed.success) valid.push(parsed.data)
    else rejected += 1
  }

  if (valid.length > 0) {
    await prisma.devEvent.createMany({
      data: valid.map(event => ({
        sessionId,
        type: event.type,
        ts: new Date(event.ts),
        payload: event.payload as Prisma.InputJsonValue,
      })),
    })
  }

  return { ok: true, accepted: valid.length, rejected }
}

function toSummary(session: {
  id: string
  startedAt: Date
  endedAt: Date | null
  platform: string | null
  events: { type: string }[]
}): DevSessionSummary {
  return {
    id: session.id,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    platform: session.platform,
    eventCount: session.events.length,
    errorCount: session.events.filter(e => e.type === 'error').length,
    apiCallCount: session.events.filter(e => e.type === 'api_call').length,
  }
}

export async function listSessions(): Promise<DevSessionSummary[]> {
  const sessions = await prisma.devSession.findMany({
    orderBy: { startedAt: 'desc' },
    include: { events: { select: { type: true } } },
  })
  return sessions.map(toSummary)
}

export async function getSessionDetail(id: string): Promise<DevSessionDetail | null> {
  const session = await prisma.devSession.findUnique({
    where: { id },
    include: { events: { orderBy: { ts: 'asc' } } },
  })
  if (!session) return null

  const events: DevSessionEvent[] = session.events.map(e => ({
    type: e.type,
    ts: e.ts.toISOString(),
    payload: e.payload as Record<string, unknown>,
  }))

  return { ...toSummary(session), events }
}
