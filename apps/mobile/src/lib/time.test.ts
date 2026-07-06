import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRelativeFr } from './time'

describe('formatRelativeFr', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('« à l’instant » sous la minute', () => {
    expect(formatRelativeFr('2026-07-06T11:59:30Z')).toBe('à l’instant')
  })

  it('minutes', () => {
    expect(formatRelativeFr('2026-07-06T11:55:00Z')).toBe('il y a 5 min')
    expect(formatRelativeFr('2026-07-06T11:01:00Z')).toBe('il y a 59 min')
  })

  it('heures', () => {
    expect(formatRelativeFr('2026-07-06T09:00:00Z')).toBe('il y a 3 h')
  })

  it('« hier » à partir de 24 h', () => {
    expect(formatRelativeFr('2026-07-05T10:00:00Z')).toBe('hier')
  })

  it('jours sous une semaine', () => {
    expect(formatRelativeFr('2026-07-03T12:00:00Z')).toBe('il y a 3 j')
  })

  it('date absolue fr-FR au-delà de 7 jours', () => {
    expect(formatRelativeFr('2026-06-01T12:00:00Z')).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
  })

  it('chaîne invalide → vide (jamais de crash d’affichage)', () => {
    expect(formatRelativeFr('pas-une-date')).toBe('')
  })
})
