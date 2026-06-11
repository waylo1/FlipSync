/**
 * Formatage du prix pour les payloads API.
 * priceCents est en CENTIMES (Int) — JAMAIS de Float monétaire.
 */
export function formatPrice(priceCents: number): string {
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    throw new Error('INVALID_PRICE_CENTS')
  }
  // "2350" → "23,50" (format français, séparateur virgule)
  return `${Math.floor(priceCents / 100)},${String(priceCents % 100).padStart(2, '0')}`
}

/**
 * Prix décimal pour les APIs qui attendent un nombre (et non une chaîne).
 * Reste dérivé de centimes Int — l'arrondi est exact à 2 décimales.
 */
export function priceToDecimal(priceCents: number): number {
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    throw new Error('INVALID_PRICE_CENTS')
  }
  return priceCents / 100
}
