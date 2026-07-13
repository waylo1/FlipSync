import { PaymentSource, TransactionType } from '../generated/enums'

// ─── Enums (GÉNÉRÉS depuis schema.prisma — cf. src/generated/enums.ts) ────────

export { PaymentSource, TransactionType }

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Toutes les valeurs monétaires sont stockées en centimes (Int).
 * Utiliser centsToEur() uniquement pour l'affichage.
 */
// ─── Contrat GET /wallet, GET /wallet/transactions — SSOT api ↔ mobile ─────────
// Dates en ISO string (forme JSON réelle du transport) — jamais Date, qui ne
// survit pas à JSON.stringify. Miroir exact du select de routes/wallet.ts
// (fix F7, FLIPSYNC-AUDIT.md : remplace le recopié manuel côté mobile).

export interface WalletDTO {
  balance:               number  // centimes
  freeListingsRemaining: number
  freeListingsResetAt:   string  // ISO
  autoRechargeEnabled:   boolean
  autoRechargeThreshold: number  // centimes
  autoRechargeAmount:    number  // centimes
  lifetimeRecharged:     number  // centimes
}

export interface WalletTransactionDTO {
  id:          string
  type:        TransactionType
  amount:      number           // centimes
  source:      PaymentSource
  listingId:   string | null
  description: string | null
  createdAt:   string           // ISO
}

// ─── Modèle économique (centimes Int — cf. CLAUDE.md) ────────────────────────

/** Bonus fidélité crédité sur la PREMIÈRE recharge (+1,00 €). */
export const FIRST_RECHARGE_BONUS_CENTS = 100

/** Montant minimum de la première recharge pour déclencher le bonus (10,00 €). */
export const FIRST_RECHARGE_BONUS_THRESHOLD_CENTS = 1000

// ─── Helpers de conversion ────────────────────────────────────────────────────

/**
 * Convertit des centimes (Int DB) en euros (Float, affichage uniquement).
 * NE PAS utiliser la valeur retournée pour des calculs ou du stockage.
 *
 * @example centsToEur(250) → 2.5  (afficher "2,50 €")
 */
export const centsToEur = (cents: number): number => cents / 100

/**
 * Convertit des euros (saisie utilisateur) en centimes (Int, stockage DB).
 * Math.round() élimine les erreurs d'arrondi flottant.
 *
 * @example eurToCents(2.50) → 250
 * @example eurToCents(9.99) → 999  (et non 998.9999...)
 */
export const eurToCents = (eur: number): number => Math.round(eur * 100)
