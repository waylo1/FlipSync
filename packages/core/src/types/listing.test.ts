import { describe, expect, it } from 'vitest'
import { ListingTier } from '../generated/enums'
import { TIER_PRICING, TIER_FEATURES } from './listing'

describe('TIER_PRICING', () => {
  it('Annonce IA 0,99 € / Premium 2,99 € (fusion Essentiel+Optimisé)', () => {
    expect(TIER_PRICING[ListingTier.SIMPLE]).toBe(99)
    expect(TIER_PRICING[ListingTier.PREMIUM]).toBe(299)
  })
})

describe('TIER_FEATURES', () => {
  it('chaque offre a un label, une tagline et une ligne de soutien non vides', () => {
    for (const tier of [ListingTier.SIMPLE, ListingTier.PREMIUM]) {
      expect(TIER_FEATURES[tier].label.length).toBeGreaterThan(0)
      expect(TIER_FEATURES[tier].tagline.length).toBeGreaterThan(0)
      expect(TIER_FEATURES[tier].support.length).toBeGreaterThan(0)
    }
  })
})
