import { describe, expect, it } from 'vitest'
import { MissionStatus } from '@flipsync/core'
import {
  DashboardMission,
  isDashboardCalm,
  missionBandeau,
  pendingValidationSummary,
  validationVariant,
} from './mission-dashboard'

const base: DashboardMission = {
  status: MissionStatus.EN_VENTE,
  activeBuyerCount: 0,
  bestOfferAmount: null,
  pendingReason: null,
  pendingOfferAmount: null,
  pendingBuyerName: null,
  soldAmount: null,
}

describe('missionBandeau — les 6 états du tableau de bord (§5.4)', () => {
  it('En vente · veille', () => {
    expect(missionBandeau(base)).toEqual({
      tone: 'faience',
      title: 'En vente · l’IA veille',
      subtitle: null,
    })
  })

  it('Négociation active — compte les acheteurs et la meilleure offre', () => {
    const m = { ...base, status: MissionStatus.NEGOCIATION_ACTIVE, activeBuyerCount: 2, bestOfferAmount: 79_000 }
    expect(missionBandeau(m)).toEqual({
      tone: 'faience',
      title: 'Négociation en cours',
      subtitle: '2 acheteurs · meilleure offre 790,00 €',
    })
  })

  it('Négociation active, un seul acheteur, pas encore d’offre', () => {
    const m = { ...base, status: MissionStatus.NEGOCIATION_ACTIVE, activeBuyerCount: 1 }
    expect(missionBandeau(m).subtitle).toBe('1 acheteur')
  })

  it('En attente de vous', () => {
    const m = { ...base, status: MissionStatus.EN_ATTENTE_VALIDATION }
    expect(missionBandeau(m)).toEqual({ tone: 'moutarde', title: 'En attente de vous', subtitle: null })
  })

  it('Vendu — affiche le montant', () => {
    const m = { ...base, status: MissionStatus.VENDU, soldAmount: 79_000 }
    expect(missionBandeau(m)).toEqual({ tone: 'bouteille', title: 'Vendu', subtitle: 'à 790,00 €' })
  })

  it('Suspendue', () => {
    const m = { ...base, status: MissionStatus.SUSPENDUE }
    expect(missionBandeau(m).tone).toBe('muted')
    expect(missionBandeau(m).title).toBe('Mission suspendue')
  })

  it('Expirée', () => {
    const m = { ...base, status: MissionStatus.EXPIREE }
    expect(missionBandeau(m).title).toBe('Mission expirée')
  })

  it('Arrêtée (menu ⋯, transverse)', () => {
    const m = { ...base, status: MissionStatus.ARRETEE }
    expect(missionBandeau(m).title).toBe('Mission arrêtée')
  })
})

describe('pendingValidationSummary — carte « en attente de vous »', () => {
  it('null hors EN_ATTENTE_VALIDATION — la section disparaît complètement', () => {
    expect(pendingValidationSummary(base)).toBeNull()
    expect(pendingValidationSummary({ ...base, status: MissionStatus.VENDU })).toBeNull()
  })

  it('offre standard', () => {
    const m = {
      ...base,
      status: MissionStatus.EN_ATTENTE_VALIDATION,
      pendingReason: 'OFFER',
      pendingOfferAmount: 79_000,
      pendingBuyerName: 'Julien M.',
    }
    expect(pendingValidationSummary(m)).toBe('Offre de Julien M. à 790,00 €')
  })

  it('offre au prix mini exact', () => {
    const m = {
      ...base,
      status: MissionStatus.EN_ATTENTE_VALIDATION,
      pendingReason: 'OFFER_AT_FLOOR',
      pendingOfferAmount: 78_000,
      pendingBuyerName: 'Julien M.',
    }
    expect(pendingValidationSummary(m)).toBe('Offre à 780,00 € — au prix mini')
  })

  it('alerte sécurité', () => {
    const m = {
      ...base,
      status: MissionStatus.EN_ATTENTE_VALIDATION,
      pendingReason: 'SECURITY_ALERT',
      pendingBuyerName: 'Julien M.',
    }
    expect(pendingValidationSummary(m)).toBe('Julien M. tente de sortir du circuit sécurisé')
  })

  it('cas complexe', () => {
    const m = {
      ...base,
      status: MissionStatus.EN_ATTENTE_VALIDATION,
      pendingReason: 'COMPLEX_CASE',
      pendingBuyerName: 'Julien M.',
    }
    expect(pendingValidationSummary(m)).toBe('Julien M. : cas hors mandat')
  })
})

describe('isDashboardCalm — écran serein quand rien n’attend le vendeur', () => {
  it('serein : en veille, aucun événement', () => {
    expect(isDashboardCalm(base, 0)).toBe(true)
  })

  it('pas serein dès qu’il y a de l’activité', () => {
    expect(isDashboardCalm(base, 3)).toBe(false)
  })

  it('pas serein hors état de veille', () => {
    expect(isDashboardCalm({ ...base, status: MissionStatus.NEGOCIATION_ACTIVE }, 0)).toBe(false)
  })
})

describe('validationVariant — les 3 variantes de la feuille S5 (§5.5)', () => {
  it('null hors EN_ATTENTE_VALIDATION', () => {
    expect(validationVariant(base)).toBeNull()
  })

  it('offre standard', () => {
    const m = {
      ...base,
      status: MissionStatus.EN_ATTENTE_VALIDATION,
      pendingReason: 'OFFER',
      pendingOfferAmount: 79_000,
      pendingBuyerName: 'Julien M.',
    }
    expect(validationVariant(m)).toEqual({ kind: 'OFFER', atFloor: false, amount: 79_000, buyerName: 'Julien M.' })
  })

  it('offre au prix mini exact — atFloor', () => {
    const m = {
      ...base,
      status: MissionStatus.EN_ATTENTE_VALIDATION,
      pendingReason: 'OFFER_AT_FLOOR',
      pendingOfferAmount: 78_000,
      pendingBuyerName: 'Julien M.',
    }
    expect(validationVariant(m)).toEqual({ kind: 'OFFER', atFloor: true, amount: 78_000, buyerName: 'Julien M.' })
  })

  it('alerte sécurité', () => {
    const m = {
      ...base,
      status: MissionStatus.EN_ATTENTE_VALIDATION,
      pendingReason: 'SECURITY_ALERT',
      pendingBuyerName: 'Julien M.',
    }
    expect(validationVariant(m)).toEqual({ kind: 'SECURITY_ALERT', buyerName: 'Julien M.' })
  })

  it('cas complexe', () => {
    const m = {
      ...base,
      status: MissionStatus.EN_ATTENTE_VALIDATION,
      pendingReason: 'COMPLEX_CASE',
      pendingBuyerName: 'Julien M.',
    }
    expect(validationVariant(m)).toEqual({ kind: 'COMPLEX_CASE', buyerName: 'Julien M.' })
  })

  it('offre retirée : reason OFFER mais montant absent — null (DoD Lot 6)', () => {
    const m = {
      ...base,
      status: MissionStatus.EN_ATTENTE_VALIDATION,
      pendingReason: 'OFFER',
      pendingOfferAmount: null,
      pendingBuyerName: 'Julien M.',
    }
    expect(validationVariant(m)).toBeNull()
  })
})
