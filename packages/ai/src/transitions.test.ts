import { describe, expect, it } from 'vitest'
import { CANCELLABLE_STATUSES, LISTING_TRANSITIONS, canTransition } from './transitions'

const ALL_STATUSES = [
  'PENDING_AUTH',
  'AUTHORIZED',
  'AI_PROCESSING',
  'AI_FAILED',
  'DRAFT_READY',
  'USER_VALIDATED',
  'USER_CANCELLED',
  'QUEUED',
  'PUBLISH_FAILED',
  'PUBLISHED',
  'EXPIRED',
] as const

describe('LISTING_TRANSITIONS', () => {
  it('couvre exactement les 11 états', () => {
    expect(Object.keys(LISTING_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort())
  })

  it('chemin nominal complet autorisé', () => {
    expect(canTransition('PENDING_AUTH', 'AUTHORIZED')).toBe(true)
    expect(canTransition('AUTHORIZED', 'AI_PROCESSING')).toBe(true)
    expect(canTransition('AI_PROCESSING', 'DRAFT_READY')).toBe(true)
    expect(canTransition('DRAFT_READY', 'USER_VALIDATED')).toBe(true)
    expect(canTransition('USER_VALIDATED', 'QUEUED')).toBe(true)
    expect(canTransition('QUEUED', 'PUBLISHED')).toBe(true)
    expect(canTransition('PUBLISHED', 'EXPIRED')).toBe(true)
  })

  it('branches d’échec autorisées', () => {
    expect(canTransition('AI_PROCESSING', 'AI_FAILED')).toBe(true)
    expect(canTransition('QUEUED', 'PUBLISH_FAILED')).toBe(true)
  })

  it('les états terminaux n’ont aucune sortie', () => {
    for (const terminal of ['AI_FAILED', 'USER_CANCELLED', 'PUBLISH_FAILED', 'EXPIRED'] as const) {
      expect(LISTING_TRANSITIONS[terminal]).toHaveLength(0)
    }
  })

  it('pas de raccourci : impossible de sauter le débit ou la validation', () => {
    expect(canTransition('DRAFT_READY', 'QUEUED')).toBe(false) // pas de publication sans commit
    expect(canTransition('AUTHORIZED', 'DRAFT_READY')).toBe(false) // pas de brouillon sans IA
    expect(canTransition('PENDING_AUTH', 'PUBLISHED')).toBe(false)
    expect(canTransition('USER_VALIDATED', 'PUBLISHED')).toBe(false) // QUEUED obligatoire
  })

  it('annulation possible pré-débit ET depuis QUEUED (remboursement intégral) — jamais depuis PUBLISHED', () => {
    expect([...CANCELLABLE_STATUSES].sort()).toEqual(
      ['AI_PROCESSING', 'AUTHORIZED', 'DRAFT_READY', 'PENDING_AUTH', 'QUEUED'].sort(),
    )
    expect(canTransition('USER_VALIDATED', 'USER_CANCELLED')).toBe(false)
    expect(canTransition('QUEUED', 'USER_CANCELLED')).toBe(true)
    expect(canTransition('PUBLISHED', 'USER_CANCELLED')).toBe(false)
  })
})
