import { describe, expect, it } from 'vitest'
import { formatPrice, priceToDecimal } from './format'

describe('formatPrice / priceToDecimal — centimes Int', () => {
  it('formate les centimes en chaîne FR', () => {
    expect(formatPrice(2350)).toBe('23,50')
    expect(formatPrice(80)).toBe('0,80')
    expect(formatPrice(100000)).toBe('1000,00')
  })

  it('dérive un décimal exact', () => {
    expect(priceToDecimal(2350)).toBe(23.5)
    expect(priceToDecimal(999)).toBe(9.99)
  })

  it('rejette tout prix non entier ou <= 0', () => {
    expect(() => formatPrice(80.5)).toThrow('INVALID_PRICE_CENTS')
    expect(() => formatPrice(0)).toThrow('INVALID_PRICE_CENTS')
    expect(() => priceToDecimal(-100)).toThrow('INVALID_PRICE_CENTS')
  })
})
