/**
 * Erreurs métier du ListingEngine et du module Vision.
 * `code` est au format SNAKE_CASE — l'API les mappe en { error: code }.
 */
export class EngineError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code)
    this.name = new.target.name
  }
}

export class ListingNotFoundError extends EngineError {
  constructor() {
    super('LISTING_NOT_FOUND')
  }
}

export class InvalidTransitionError extends EngineError {
  constructor(from: string, to: string) {
    super('INVALID_TRANSITION', `Transition interdite: ${from} → ${to}`)
  }
}

export class InvalidPriceError extends EngineError {
  constructor(amount: number) {
    super('INVALID_AMOUNT', `Prix invalide: ${amount} — centimes Int >= 0 requis`)
  }
}

export class MissingFailureReasonError extends EngineError {
  constructor() {
    super('MISSING_FAILURE_REASON', 'failureReason obligatoire sur tout état *_FAILED')
  }
}

// ─── Vision ───────────────────────────────────────────────────────────────────

export class VisionTimeoutError extends EngineError {
  constructor(timeoutMs: number) {
    super('AI_TIMEOUT', `Inférence > ${timeoutMs}ms — listing à basculer en AI_FAILED`)
  }
}

export class VisionParseError extends EngineError {
  constructor(detail: string) {
    super('AI_INVALID_OUTPUT', `Sortie modèle invalide: ${detail}`)
  }
}

export class VisionBackendError extends EngineError {
  constructor(detail: string) {
    super('AI_BACKEND_ERROR', detail)
  }
}
