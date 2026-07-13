import { describe, expect, it } from 'vitest'
import { ItemCondition } from '../generated/enums'
import {
  AUCTION_DURATION_MAX_DAYS,
  isUnifiedListingValid,
  listingToUnified,
  sanitizeDescription,
  type AuctionListing,
  type FixedPriceListing,
  type ListingSyncSource,
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

describe('sanitizeDescription', () => {
  it('laisse un texte propre inchangé', () => {
    expect(sanitizeDescription('Très bon état.\n\nPeu servi.')).toBe('Très bon état.\n\nPeu servi.')
  })

  it('retire les balises HTML puis décode les entités (dans cet ordre)', () => {
    expect(sanitizeDescription('<b>Très</b> bon<br/>état')).toBe('Très bon état')
    expect(sanitizeDescription('Chaussures &amp; sac &lt;taille 38&gt;')).toBe('Chaussures & sac <taille 38>')
  })

  it('retire URLs et numéros de téléphone français', () => {
    expect(sanitizeDescription('Voir https://exemple.com/fiche ici')).toBe('Voir ici')
    expect(sanitizeDescription('Photos sur www.monsite.fr !')).toBe('Photos sur !')
    expect(sanitizeDescription('Appelez le 06 12 34 56 78 svp')).toBe('Appelez le svp')
    expect(sanitizeDescription('Tel: +33 6 12 34 56 78.')).toBe('Tel: .')
  })

  it('normalise espaces et sauts de ligne (CRLF, tabs, triples \\n)', () => {
    expect(sanitizeDescription('\r\nA\r\n\r\n\r\nB  \tC ')).toBe('A\n\nB C')
  })
})

describe('listingToUnified', () => {
  const source: ListingSyncSource = {
    id: 'lst_1',
    titre: '  Vélo enfant 16 pouces ',
    description: '<p>Très bon état.</p> Voir https://spam.io',
    marque: ' Btwin ',
    etat: ItemCondition.bon,
    prixPublie: 4500,
    categorie: 'velos',
    photos: base.photos,
  }

  it('produit un FixedPriceListing valide (trim, sanitize, EUR)', () => {
    const res = listingToUnified(source)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.listing).toEqual({
      mode: 'fixed',
      listingId: 'lst_1',
      titre: 'Vélo enfant 16 pouces',
      description: 'Très bon état. Voir',
      etat: ItemCondition.bon,
      devise: 'EUR',
      marque: 'Btwin',
      categorie: 'velos',
      prix: 4500,
      photos: base.photos,
    })
    expect(isUnifiedListingValid(res.listing)).toBe(true)
  })

  it('liste TOUS les champs manquants (échec unique, diagnostic complet)', () => {
    const res = listingToUnified({
      ...source,
      titre: null,
      etat: null,
      prixPublie: null,
      photos: [],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.missing).toEqual(['titre', 'etat', 'prixPublie', 'photos'])
  })

  it('rejette un prix non entier ou non positif', () => {
    expect(listingToUnified({ ...source, prixPublie: 45.5 }).ok).toBe(false)
    expect(listingToUnified({ ...source, prixPublie: 0 }).ok).toBe(false)
  })

  it('rejette une description vidée par le nettoyage (URL seule)', () => {
    const res = listingToUnified({ ...source, description: 'https://spam.io/annonce' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.missing).toEqual(['description'])
  })

  it('normalise une marque vide en null', () => {
    const res = listingToUnified({ ...source, marque: '   ' })
    expect(res.ok && res.listing.marque).toBe(null)
  })
})
