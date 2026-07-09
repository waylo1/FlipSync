import type { DevSessionDetail, DevSessionEvent } from '@flipsync/core'

/**
 * Formats d'export d'une session — tous dérivés de la même source
 * (DevSessionDetail, cf. dev-sessions.service.getSessionDetail). Aucune donnée
 * inventée, aucune conclusion : uniquement ce qui a été réellement enregistré.
 */
export const EXPORT_FORMATS = ['events', 'report', 'llm-context', 'llm-prompt'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export interface ExportFile {
  filename: string
  contentType: string
  body: string
}

function findDeviceInfo(events: DevSessionEvent[]): Record<string, unknown> | null {
  const event = events.find(e => e.type === 'device_info')
  return event ? event.payload : null
}

function formatTs(ts: string): string {
  return (new Date(ts).toISOString().split('T')[1] ?? ts).replace('Z', '')
}

/** events.json — export brut, sans transformation : la source de vérité telle quelle. */
function toEventsJson(detail: DevSessionDetail): string {
  return JSON.stringify(detail, null, 2)
}

/** report.md — lecture humaine rapide de la timeline, sections par nature d'événement. */
function toReportMd(detail: DevSessionDetail): string {
  const device = findDeviceInfo(detail.events)
  const errors = detail.events.filter(e => e.type === 'error')
  const warnings = detail.events.filter(e => e.type === 'console' && (e.payload as { level?: string }).level === 'warn')
  const apiCalls = detail.events.filter(e => e.type === 'api_call')

  const lines: string[] = []
  lines.push(`# Session ${detail.id}`)
  lines.push('')
  lines.push('## Métadonnées')
  lines.push(`- Démarrée : ${detail.startedAt}`)
  lines.push(`- Terminée : ${detail.endedAt ?? '(en cours)'}`)
  lines.push(`- Plateforme : ${detail.platform ?? 'inconnue'}`)
  lines.push(`- Événements : ${detail.eventCount} (${detail.errorCount} erreur(s), ${detail.apiCallCount} appel(s) API)`)
  if (device) lines.push(`- Appareil : ${JSON.stringify(device)}`)
  lines.push('')

  lines.push('## Timeline')
  for (const event of detail.events) {
    lines.push(`- \`${formatTs(event.ts)}\` **${event.type}** ${JSON.stringify(event.payload)}`)
  }
  lines.push('')

  if (errors.length > 0) {
    lines.push('## Erreurs')
    for (const e of errors) lines.push(`- \`${formatTs(e.ts)}\` ${JSON.stringify(e.payload)}`)
    lines.push('')
  }

  if (warnings.length > 0) {
    lines.push('## Warnings console')
    for (const w of warnings) lines.push(`- \`${formatTs(w.ts)}\` ${JSON.stringify(w.payload)}`)
    lines.push('')
  }

  if (apiCalls.length > 0) {
    lines.push('## Appels API')
    for (const a of apiCalls) lines.push(`- \`${formatTs(a.ts)}\` ${JSON.stringify(a.payload)}`)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * llm-context.json — mêmes données que events.json, réorganisées pour qu'un LLM
 * comprenne la session sans contexte externe (regroupement par nature, pas de
 * synthèse ni d'interprétation ajoutée).
 */
function toLlmContextJson(detail: DevSessionDetail): string {
  const context = {
    session: {
      id: detail.id,
      startedAt: detail.startedAt,
      endedAt: detail.endedAt,
      platform: detail.platform,
    },
    device: findDeviceInfo(detail.events),
    timeline: detail.events.map(e => ({ ts: e.ts, type: e.type, payload: e.payload })),
    errors: detail.events.filter(e => e.type === 'error').map(e => ({ ts: e.ts, payload: e.payload })),
    warnings: detail.events
      .filter(e => e.type === 'console' && (e.payload as { level?: string }).level === 'warn')
      .map(e => ({ ts: e.ts, payload: e.payload })),
    apiCalls: detail.events.filter(e => e.type === 'api_call').map(e => ({ ts: e.ts, payload: e.payload })),
    navigation: detail.events.filter(e => e.type === 'navigation').map(e => ({ ts: e.ts, payload: e.payload })),
    actions: detail.events.filter(e => e.type === 'action').map(e => ({ ts: e.ts, payload: e.payload })),
  }
  return JSON.stringify(context, null, 2)
}

/**
 * llm-prompt.md — même contenu que llm-context.json, encapsulé dans un texte
 * prêt à coller. Aucune IA n'intervient dans sa génération : c'est un gabarit
 * fixe autour de données factuelles, pas une analyse.
 */
function toLlmPromptMd(detail: DevSessionDetail): string {
  const context = toLlmContextJson(detail)
  return [
    `# Contexte technique — session de développement ${detail.id}`,
    '',
    "Voici le contexte factuel d'une session de développement enregistrée automatiquement.",
    "Aucune hypothèse ni conclusion n'a été ajoutée : uniquement les événements réellement mesurés",
    '(navigation, actions utilisateur, appels API, erreurs, warnings, informations appareil),',
    'dans leur ordre chronologique.',
    '',
    '```json',
    context,
    '```',
  ].join('\n')
}

export function buildExport(detail: DevSessionDetail, format: ExportFormat): ExportFile {
  switch (format) {
    case 'events':
      return { filename: 'events.json', contentType: 'application/json', body: toEventsJson(detail) }
    case 'report':
      return { filename: 'report.md', contentType: 'text/markdown', body: toReportMd(detail) }
    case 'llm-context':
      return { filename: 'llm-context.json', contentType: 'application/json', body: toLlmContextJson(detail) }
    case 'llm-prompt':
      return { filename: 'llm-prompt.md', contentType: 'text/markdown', body: toLlmPromptMd(detail) }
  }
}
