import { describe, expect, it } from 'vitest'
import { ListingTier } from '../generated/enums'
import { TIER_PHOTO_COUNT, TIER_PRICING, TIER_FEATURES } from './listing'

describe('TIER_PHOTO_COUNT', () => {
  it('SIMPLE = 1, OPTIMIZED = 2, PREMIUM = 3 photo(s) analysée(s)', () => {
    expect(TIER_PHOTO_COUNT[ListingTier.SIMPLE]).toBe(1)
    expect(TIER_PHOTO_COUNT[ListingTier.OPTIMIZED]).toBe(2)
    expect(TIER_PHOTO_COUNT[ListingTier.PREMIUM]).toBe(3)
  })

  it('progression strictement croissante — chaque palier analyse plus de photos que le précédent', () => {
    expect(TIER_PHOTO_COUNT[ListingTier.OPTIMIZED]).toBeGreaterThan(TIER_PHOTO_COUNT[ListingTier.SIMPLE])
    expect(TIER_PHOTO_COUNT[ListingTier.PREMIUM]).toBeGreaterThan(TIER_PHOTO_COUNT[ListingTier.OPTIMIZED])
  })
})

describe('TIER_PRICING', () => {
  it('Essentiel 0,99 € / Optimisé 1,99 € / Premium 2,99 €', () => {
    expect(TIER_PRICING[ListingTier.SIMPLE]).toBe(99)
    expect(TIER_PRICING[ListingTier.OPTIMIZED]).toBe(199)
    expect(TIER_PRICING[ListingTier.PREMIUM]).toBe(299)
  })
})

describe('TIER_FEATURES', () => {
  it('chaque offre a un label, une tagline et une ligne de soutien non vides', () => {
    for (const tier of [ListingTier.SIMPLE, ListingTier.OPTIMIZED, ListingTier.PREMIUM]) {
      expect(TIER_FEATURES[tier].label.length).toBeGreaterThan(0)
      expect(TIER_FEATURES[tier].tagline.length).toBeGreaterThan(0)
      expect(TIER_FEATURES[tier].support.length).toBeGreaterThan(0)
    }
  })
})
