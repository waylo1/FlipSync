import { describe, expect, it } from 'vitest'
import { ItemCondition } from '../generated/enums'
import {
  AUCTION_DURATION_MAX_DAYS,
  isUnifiedListingValid,
  type AuctionListing,
  type FixedPriceListing,
} from './sync'

const base = {
  listingId: 'lst_1',
  titre: 'Vélo enfant 16 pouces',
  description: 'Très bon état, pneus récents.',
  etat: ItemCondition.bon,
  devise: 'EUR',
  marque: null,
  categorie: 'velos',
  photos: [{ url: 'https://cdn.flipsync.fr/p1.jpg', order: 0 }],
} as const

const fixed: FixedPriceListing = { ...base, mode: 'fixed', prix: 4500 }
const auction: AuctionListing = {
  ...base,
  mode: 'auction',
  prixDepart: 100,
  prixReserve: 4500,
  dureeJours: 7,
}

describe('isUnifiedListingValid', () => {
  it('accepte les deux modes valides', () => {
    expect(isUnifiedListingValid(fixed)).toBe(true)
    expect(isUnifiedListingValid(auction)).toBe(true)
    expect(isUnifiedListingValid({ ...auction, prixReserve: null })).toBe(true)
  })

  it('rejette un prix non entier ou non positif (centimes Int obligatoires)', () => {
    expect(isUnifiedListingValid({ ...fixed, prix: 45.5 })).toBe(false)
    expect(isUnifiedListingValid({ ...fixed, prix: 0 })).toBe(false)
    expect(isUnifiedListingValid({ ...auction, prixDepart: 0 })).toBe(false)
  })

  it('rejette une réserve sous le prix de départ', () => {
    expect(isUnifiedListingValid({ ...auction, prixDepart: 5000, prixReserve: 4999 })).toBe(false)
  })

  it("borne la durée d'enchère (entiers 1–30 jours)", () => {
    expect(isUnifiedListingValid({ ...auction, dureeJours: 0 })).toBe(false)
    expect(isUnifiedListingValid({ ...auction, dureeJours: AUCTION_DURATION_MAX_DAYS + 1 })).toBe(false)
    expect(isUnifiedListingValid({ ...auction, dureeJours: 2.5 })).toBe(false)
  })

  it('exige titre, description et au moins une photo', () => {
    expect(isUnifiedListingValid({ ...fixed, titre: '  ' })).toBe(false)
    expect(isUnifiedListingValid({ ...fixed, description: '' })).toBe(false)
    expect(isUnifiedListingValid({ ...fixed, photos: [] })).toBe(false)
  })
})
