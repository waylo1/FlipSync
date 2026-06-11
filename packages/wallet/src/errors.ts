/**
 * Erreurs métier du wallet.
 * `code` est au format SNAKE_CASE — l'API les mappe en { error: code } (cf. conventions).
 */
export class WalletError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code)
    this.name = new.target.name
  }
}

export class WalletNotFoundError extends WalletError {
  constructor() {
    super('WALLET_NOT_FOUND')
  }
}

export class ListingNotFoundError extends WalletError {
  constructor() {
    super('LISTING_NOT_FOUND')
  }
}

export class InvalidAmountError extends WalletError {
  constructor(amount: number) {
    super('INVALID_AMOUNT', `Montant invalide: ${amount} — centimes Int >= 0 requis`)
  }
}

export class InvalidListingStateError extends WalletError {
  constructor(actual: string, expected: string) {
    super('INVALID_LISTING_STATE', `Statut ${actual}, attendu ${expected}`)
  }
}

export class AlreadyCommittedError extends WalletError {
  constructor() {
    super('ALREADY_COMMITTED')
  }
}

export class InsufficientFundsError extends WalletError {
  constructor() {
    super('INSUFFICIENT_FUNDS')
  }
}

export class NoFreeCreditError extends WalletError {
  constructor() {
    super('NO_FREE_CREDIT')
  }
}

export class InvalidPaymentSourceError extends WalletError {
  constructor(source: string) {
    super('INVALID_PAYMENT_SOURCE', `Source non débitable: ${source}`)
  }
}

export class NothingToRefundError extends WalletError {
  constructor() {
    super('NOTHING_TO_REFUND')
  }
}
