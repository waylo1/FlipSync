import { describe, expect, it } from 'vitest'
import {
  ComplexCasePolicy,
  DEFAULT_POSTURE,
  DeliveryPreference,
  POSTURE_ORDER,
  POSTURE_PRESETS,
  SellObjective,
  SellPosture,
  defaultMandate,
  isMandateValid,
  negotiationMarginPct,
} from './mission'

describe('POSTURE_PRESETS', () => {
  it('couvre les 4 postures avec des libellés non vides', () => {
    for (const posture of Object.values(SellPosture)) {
      const p = POSTURE_PRESETS[posture]
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.emoji.length).toBeGreaterThan(0)
      expect(p.promesse.length).toBeGreaterThan(0)
      expect(p.support.length).toBeGreaterThan(0)
    }
  })

  it('exprime la montée en autonomie/prix attendue (cadrans internes)', () => {
    // Vente rapide : lâche fort, décide seule.
    expect(POSTURE_PRESETS[SellPosture.RAPIDE].concession).toBe('forte')
    expect(POSTURE_PRESETS[SellPosture.RAPIDE].autonomie).toBe('haute')
    // Meilleur prix : concède peu.
    expect(POSTURE_PRESETS[SellPosture.MEILLEUR_PRIX].concession).toBe('faible')
    // Très prudent : réfère beaucoup (autonomie basse).
    expect(POSTURE_PRESETS[SellPosture.PRUDENT].autonomie).toBe('basse')
  })

  it('POSTURE_ORDER liste chaque posture exactement une fois', () => {
    expect([...POSTURE_ORDER].sort()).toEqual(Object.values(SellPosture).sort())
  })

  it('le défaut est Équilibré', () => {
    expect(DEFAULT_POSTURE).toBe(SellPosture.EQUILIBRE)
  })
})

describe('negotiationMarginPct', () => {
  it('820 € affiché, 780 € mini → -5 %', () => {
    expect(negotiationMarginPct(82000, 78000)).toBe(-5)
  })

  it('mini = affiché → 0 %', () => {
    expect(negotiationMarginPct(50000, 50000)).toBe(0)
  })

  it('prix affiché nul → 0 (pas de division par zéro)', () => {
    expect(negotiationMarginPct(0, 0)).toBe(0)
  })
})

describe('isMandateValid', () => {
  const base = defaultMandate(82000, 78000)

  it('accepte un plancher strictement positif et ≤ prix affiché', () => {
    expect(isMandateValid(base)).toBe(true)
  })

  it('refuse un plancher au-dessus du prix affiché', () => {
    expect(isMandateValid({ ...base, prixMini: 90000 })).toBe(false)
  })

  it('refuse un plancher nul ou négatif', () => {
    expect(isMandateValid({ ...base, prixMini: 0 })).toBe(false)
  })
})

describe('defaultMandate', () => {
  it('pré-remplit le prix mini avec le prix plancher estimé', () => {
    const m = defaultMandate(82000, 78000)
    expect(m.prixMini).toBe(78000)
    expect(m.prixAffiche).toBe(82000)
  })

  it('borne le prix mini au prix affiché si le plancher le dépasse', () => {
    const m = defaultMandate(50000, 60000)
    expect(m.prixMini).toBe(50000)
    expect(isMandateValid(m)).toBe(true)
  })

  it('applique les défauts les plus sûrs (livraison, cas complexes, coup de marteau humain)', () => {
    const m = defaultMandate(82000, 78000)
    expect(m.livraison).toBe(DeliveryPreference.LES_DEUX)
    expect(m.casComplexes).toBe(ComplexCasePolicy.ME_DEMANDER)
    expect(m.autoAdjugeAuDessusDuMini).toBe(false)
  })

  it('aligne l’objectif sur la posture choisie', () => {
    expect(defaultMandate(82000, 78000, SellPosture.MEILLEUR_PRIX).objectif).toBe(
      SellObjective.MEILLEUR_PRIX,
    )
    expect(defaultMandate(82000, 78000, SellPosture.RAPIDE).objectif).toBe(
      SellObjective.VENDRE_VITE,
    )
  })
})
