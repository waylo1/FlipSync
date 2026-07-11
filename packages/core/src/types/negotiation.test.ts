import { describe, expect, it } from 'vitest'
import { MissionStatus } from '../generated/enums'
import { ComplexCasePolicy, DeliveryPreference, SellMandate, defaultMandate } from './mission'
import {
  MissionTransitionError,
  SimulatedChannel,
  applyMissionEvent,
  canSendReminder,
  decideNegotiation,
  redactOutboundMessage,
} from './negotiation'

const mandate: SellMandate = defaultMandate(82_000, 78_000)

const offer = (amount: number, overrides?: Partial<SellMandate>) =>
  decideNegotiation(
    { ...mandate, ...overrides },
    {
      kind: 'OFFER',
      offer: { buyerId: 'b1', buyerName: 'Julien M.', amount, signals: { verified: true } },
    },
  )

describe('decideNegotiation — R1 plancher dur', () => {
  it('refuse toute offre strictement sous le prix mini, jamais transmise à validation', () => {
    expect(offer(77_999)).toEqual({ type: 'DECLINE', reason: 'BELOW_FLOOR' })
  })

  it("refuse même avec l'auto-adjuge activé — le plancher n'est jamais désactivable", () => {
    expect(offer(1, { autoAdjugeAuDessusDuMini: true })).toEqual({
      type: 'DECLINE',
      reason: 'BELOW_FLOOR',
    })
  })
})

describe('decideNegotiation — R4 coup de marteau', () => {
  it('offre au-dessus du mini, humain par défaut → validation requise', () => {
    expect(offer(80_000)).toEqual({ type: 'REQUIRE_VALIDATION', reason: 'OFFER' })
  })

  it('offre exactement au prix mini, humain par défaut → variante dédiée OFFER_AT_FLOOR', () => {
    expect(offer(78_000)).toEqual({ type: 'REQUIRE_VALIDATION', reason: 'OFFER_AT_FLOOR' })
  })

  it('auto-adjuge activé et offre ≥ mini → acceptation zéro-clic', () => {
    expect(offer(78_000, { autoAdjugeAuDessusDuMini: true })).toEqual({
      type: 'AUTO_ACCEPT',
      amount: 78_000,
    })
    expect(offer(81_000, { autoAdjugeAuDessusDuMini: true })).toEqual({
      type: 'AUTO_ACCEPT',
      amount: 81_000,
    })
  })
})

describe('decideNegotiation — R3 circuit sécurisé', () => {
  it("une tentative de paiement hors circuit n'est jamais acceptée seule", () => {
    expect(
      decideNegotiation(mandate, {
        kind: 'OFF_PLATFORM_PAYMENT',
        buyerId: 'b1',
        buyerName: 'Julien M.',
        text: 'On peut faire par virement direct ?',
      }),
    ).toEqual({ type: 'REQUIRE_VALIDATION', reason: 'SECURITY_ALERT' })
  })
})

describe('decideNegotiation — R5 livraison', () => {
  it("accepte un mode couvert par le mandat ('Les deux' → tout passe)", () => {
    expect(
      decideNegotiation(mandate, {
        kind: 'DELIVERY_REQUEST',
        buyerId: 'b1',
        buyerName: 'Julien M.',
        mode: DeliveryPreference.ENVOI,
      }),
    ).toEqual({ type: 'AUTO_REPLY' })
  })

  it('refuse un mode hors mandat', () => {
    const mainPropreOnly = { ...mandate, livraison: DeliveryPreference.MAIN_PROPRE }
    expect(
      decideNegotiation(mainPropreOnly, {
        kind: 'DELIVERY_REQUEST',
        buyerId: 'b1',
        buyerName: 'Julien M.',
        mode: DeliveryPreference.ENVOI,
      }),
    ).toEqual({ type: 'DECLINE', reason: 'DELIVERY_NOT_ALLOWED' })
  })
})

describe('decideNegotiation — R6 cas hors mandat', () => {
  const complexCase = (casComplexes: ComplexCasePolicy) =>
    decideNegotiation(
      { ...mandate, casComplexes },
      { kind: 'COMPLEX_CASE', buyerId: 'b1', buyerName: 'Julien M.', question: 'Échange possible ?' },
    )

  it('ME_DEMANDER → validation requise', () => {
    expect(complexCase(ComplexCasePolicy.ME_DEMANDER)).toEqual({
      type: 'REQUIRE_VALIDATION',
      reason: 'COMPLEX_CASE',
    })
  })

  it('REFUSER → décline', () => {
    expect(complexCase(ComplexCasePolicy.REFUSER)).toEqual({
      type: 'DECLINE',
      reason: 'COMPLEX_CASE_REFUSED',
    })
  })

  it("CONTINUER → maintient le contact sans jamais s'engager", () => {
    expect(complexCase(ComplexCasePolicy.CONTINUER)).toEqual({ type: 'CONTINUE_NO_COMMIT' })
  })
})

describe('decideNegotiation — questions factuelles', () => {
  it("répond seule à une question factuelle (§2.1)", () => {
    expect(
      decideNegotiation(mandate, {
        kind: 'QUESTION',
        buyerId: 'b1',
        buyerName: 'Julien M.',
        text: 'Encore dispo ?',
      }),
    ).toEqual({ type: 'AUTO_REPLY' })
  })
})

describe('redactOutboundMessage — R2 confidentialité', () => {
  it('masque un numéro de téléphone', () => {
    expect(redactOutboundMessage('Appelez-moi au 06 12 34 56 78 !')).toBe(
      'Appelez-moi au [coordonnées masquées] !',
    )
  })

  it('masque une adresse email', () => {
    expect(redactOutboundMessage('Contact : julien.m@example.com')).toBe(
      'Contact : [coordonnées masquées]',
    )
  })

  it('masque un lien externe', () => {
    expect(redactOutboundMessage('Voir https://exemple.com/profil pour plus de détails')).toBe(
      'Voir [lien masqué] pour plus de détails',
    )
  })

  it('laisse intact un texte sans coordonnées', () => {
    expect(redactOutboundMessage('Oui, toujours disponible, envoi possible.')).toBe(
      'Oui, toujours disponible, envoi possible.',
    )
  })
})

describe('canSendReminder — R7 relance unique', () => {
  it('autorise la première relance', () => {
    expect(canSendReminder(false)).toBe(true)
  })

  it("refuse toute relance au-delà de la première — jamais de harcèlement", () => {
    expect(canSendReminder(true)).toBe(false)
  })
})

describe('applyMissionEvent — machine à états §6', () => {
  it('BROUILLON_MANDAT → EN_VENTE à la confirmation du mandat', () => {
    expect(applyMissionEvent(MissionStatus.BROUILLON_MANDAT, { type: 'MANDATE_CONFIRMED' })).toBe(
      MissionStatus.EN_VENTE,
    )
  })

  it("EN_VENTE → NEGOCIATION_ACTIVE dès qu'un acheteur écrit", () => {
    expect(applyMissionEvent(MissionStatus.EN_VENTE, { type: 'BUYER_MESSAGE' })).toBe(
      MissionStatus.NEGOCIATION_ACTIVE,
    )
  })

  it('NEGOCIATION_ACTIVE → EN_ATTENTE_VALIDATION sur cas hors mandat / coup de marteau', () => {
    expect(applyMissionEvent(MissionStatus.NEGOCIATION_ACTIVE, { type: 'VALIDATION_REQUIRED' })).toBe(
      MissionStatus.EN_ATTENTE_VALIDATION,
    )
  })

  it('EN_ATTENTE_VALIDATION → NEGOCIATION_ACTIVE une fois la validation résolue sans vente', () => {
    expect(
      applyMissionEvent(MissionStatus.EN_ATTENTE_VALIDATION, { type: 'VALIDATION_RESOLVED' }),
    ).toBe(MissionStatus.NEGOCIATION_ACTIVE)
  })

  it('NEGOCIATION_ACTIVE et EN_ATTENTE_VALIDATION mènent tous deux à VENDU', () => {
    expect(applyMissionEvent(MissionStatus.NEGOCIATION_ACTIVE, { type: 'SALE_CONFIRMED' })).toBe(
      MissionStatus.VENDU,
    )
    expect(applyMissionEvent(MissionStatus.EN_ATTENTE_VALIDATION, { type: 'SALE_CONFIRMED' })).toBe(
      MissionStatus.VENDU,
    )
  })

  it('VENDU → MISSION_TERMINEE', () => {
    expect(applyMissionEvent(MissionStatus.VENDU, { type: 'MISSION_FINALIZED' })).toBe(
      MissionStatus.MISSION_TERMINEE,
    )
  })

  it('transitions transverses : suspendre puis reprendre exactement où on était', () => {
    expect(applyMissionEvent(MissionStatus.NEGOCIATION_ACTIVE, { type: 'SUSPENDED' })).toBe(
      MissionStatus.SUSPENDUE,
    )
    expect(
      applyMissionEvent(MissionStatus.SUSPENDUE, {
        type: 'RESUMED',
        to: MissionStatus.NEGOCIATION_ACTIVE,
      }),
    ).toBe(MissionStatus.NEGOCIATION_ACTIVE)
  })

  it('transitions transverses : arrêter et expirer sont accessibles depuis les états actifs', () => {
    expect(applyMissionEvent(MissionStatus.EN_VENTE, { type: 'STOPPED' })).toBe(MissionStatus.ARRETEE)
    expect(applyMissionEvent(MissionStatus.NEGOCIATION_ACTIVE, { type: 'EXPIRED' })).toBe(
      MissionStatus.EXPIREE,
    )
  })

  it('refuse une transition non prévue (ex. vendre depuis un mandat encore brouillon)', () => {
    expect(() => applyMissionEvent(MissionStatus.BROUILLON_MANDAT, { type: 'SALE_CONFIRMED' })).toThrow(
      MissionTransitionError,
    )
  })

  it('refuse de reprendre une mission qui n’est pas suspendue', () => {
    expect(() =>
      applyMissionEvent(MissionStatus.EN_VENTE, { type: 'RESUMED', to: MissionStatus.EN_VENTE }),
    ).toThrow(MissionTransitionError)
  })

  it("un état terminal (MISSION_TERMINEE, ARRETEE, EXPIREE) n'accepte plus aucun événement", () => {
    expect(() =>
      applyMissionEvent(MissionStatus.MISSION_TERMINEE, { type: 'MANDATE_CONFIRMED' }),
    ).toThrow(MissionTransitionError)
    expect(() => applyMissionEvent(MissionStatus.ARRETEE, { type: 'BUYER_MESSAGE' })).toThrow(
      MissionTransitionError,
    )
    expect(() => applyMissionEvent(MissionStatus.EXPIREE, { type: 'BUYER_MESSAGE' })).toThrow(
      MissionTransitionError,
    )
  })
})

describe('SimulatedChannel — §9 frontière NegotiationChannel', () => {
  it('injecte puis pull vide la file (les messages ne sont livrés qu’une fois)', () => {
    const channel = new SimulatedChannel()
    channel.inject({ kind: 'QUESTION', buyerId: 'b1', buyerName: 'Julien M.', text: 'Dispo ?' })

    expect(channel.pull()).toHaveLength(1)
    expect(channel.pull()).toHaveLength(0)
  })

  it('reply() applique le filtre R2 avant de "sortir"', () => {
    const channel = new SimulatedChannel()
    channel.reply({ buyerId: 'b1', text: 'Appelez le 06 12 34 56 78' })

    expect(channel.sentReplies[0]?.text).toBe('Appelez le [coordonnées masquées]')
  })

  it('propose/accept/reject journalisent les actions pour les tests/démo', () => {
    const channel = new SimulatedChannel()
    channel.propose('b1', 79_000)
    channel.accept('b1')
    channel.reject('b2')

    expect(channel.proposals).toEqual([{ buyerId: 'b1', amount: 79_000 }])
    expect(channel.accepted).toEqual(['b1'])
    expect(channel.rejected).toEqual(['b2'])
  })
})
