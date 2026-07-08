import { describe, expect, it } from 'vitest'
import { ListingTier } from '../generated/enums'
import { TIER_PHOTO_COUNT, TIER_FEATURES, cumulativeTierFeatures } from './listing'

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

describe('cumulativeTierFeatures', () => {
  it('SIMPLE — seulement ses propres bullets', () => {
    expect(cumulativeTierFeatures(ListingTier.SIMPLE)).toEqual([...TIER_FEATURES[ListingTier.SIMPLE].adds])
  })

  it('OPTIMIZED — concatène SIMPLE puis OPTIMIZED, dans cet ordre', () => {
    expect(cumulativeTierFeatures(ListingTier.OPTIMIZED)).toEqual([
      ...TIER_FEATURES[ListingTier.SIMPLE].adds,
      ...TIER_FEATURES[ListingTier.OPTIMIZED].adds,
    ])
  })

  it('PREMIUM — concatène SIMPLE, OPTIMIZED puis PREMIUM, dans cet ordre', () => {
    expect(cumulativeTierFeatures(ListingTier.PREMIUM)).toEqual([
      ...TIER_FEATURES[ListingTier.SIMPLE].adds,
      ...TIER_FEATURES[ListingTier.OPTIMIZED].adds,
      ...TIER_FEATURES[ListingTier.PREMIUM].adds,
    ])
  })
})
