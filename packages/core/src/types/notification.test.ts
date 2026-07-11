import { describe, expect, it } from 'vitest'
import { isThrottledKind, notificationContent, shouldNotify } from './notification'

describe('notificationContent — textes exacts §7', () => {
  it('validation requise', () => {
    expect(notificationContent('VALIDATION_REQUIRED', 'Veste cuir')).toEqual({
      kind: 'VALIDATION_REQUIRED',
      tone: 'moutarde',
      text: 'L\'IA attend votre feu vert pour « Veste cuir ».',
    })
  })

  it('alerte sécurité — texte générique, pas de nom d’objet', () => {
    expect(notificationContent('SECURITY_ALERT', 'Veste cuir')).toEqual({
      kind: 'SECURITY_ALERT',
      tone: 'brique',
      text: 'Un acheteur tente de sortir du circuit sécurisé.',
    })
  })

  it('vendu — montant formaté', () => {
    expect(notificationContent('SOLD', 'Veste cuir', 79_000)).toEqual({
      kind: 'SOLD',
      tone: 'bouteille',
      text: 'Vendu 790,00 € ! L\'IA a conclu « Veste cuir ».',
    })
  })
})

describe('shouldNotify — anti-spam §7 : 1 notif de négociation max par heure', () => {
  const now = new Date('2026-07-11T12:00:00Z')

  it('première alerte jamais bloquée', () => {
    expect(shouldNotify('VALIDATION_REQUIRED', null, now)).toBe(true)
  })

  it('bloque une seconde notif de négociation dans l’heure', () => {
    const last = new Date('2026-07-11T11:30:00Z')
    expect(shouldNotify('VALIDATION_REQUIRED', last, now)).toBe(false)
    expect(shouldNotify('SECURITY_ALERT', last, now)).toBe(false)
  })

  it('autorise après une heure pile', () => {
    const last = new Date('2026-07-11T11:00:00Z')
    expect(shouldNotify('VALIDATION_REQUIRED', last, now)).toBe(true)
  })

  it('SOLD n’est jamais throttlé — événement terminal unique', () => {
    const last = new Date('2026-07-11T11:59:59Z')
    expect(shouldNotify('SOLD', last, now)).toBe(true)
  })
})

describe('isThrottledKind', () => {
  it('négociation = régulée, vente = non régulée', () => {
    expect(isThrottledKind('VALIDATION_REQUIRED')).toBe(true)
    expect(isThrottledKind('SECURITY_ALERT')).toBe(true)
    expect(isThrottledKind('SOLD')).toBe(false)
  })
})
