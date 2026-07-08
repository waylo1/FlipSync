import { ListingStatus } from '@flipsync/db'

/**
 * Machine à états ListingStatus — 11 états, transitions STRICTES (cf. CLAUDE.md) :
 *
 *   PENDING_AUTH → AUTHORIZED → AI_PROCESSING → DRAFT_READY → USER_VALIDATED → QUEUED → PUBLISHED
 *                                     ↓                              ↓
 *                                 AI_FAILED                   USER_CANCELLED → PUBLISH_FAILED → EXPIRED
 *
 * Invariants :
 *   - Toute transition avant USER_VALIDATED est gratuite et réversible (0 débit).
 *   - commit() s'exécute À la transition DRAFT_READY → USER_VALIDATED (atomique).
 *   - AI_FAILED, USER_CANCELLED, PUBLISH_FAILED, EXPIRED sont terminaux.
 *   - Annulation utilisateur : possible pré-commit (0 débit) ET depuis QUEUED
 *     (post-commit, remboursement intégral — cf. ListingEngine.cancel). Pas
 *     depuis PUBLISHED : la retirer d'une marketplace où elle est déjà en ligne
 *     est un cas distinct, non couvert ici.
 */
export const LISTING_TRANSITIONS: Readonly<Record<ListingStatus, readonly ListingStatus[]>> = {
  [ListingStatus.PENDING_AUTH]: [ListingStatus.AUTHORIZED, ListingStatus.USER_CANCELLED],
  [ListingStatus.AUTHORIZED]: [ListingStatus.AI_PROCESSING, ListingStatus.USER_CANCELLED],
  [ListingStatus.AI_PROCESSING]: [
    ListingStatus.DRAFT_READY,
    ListingStatus.AI_FAILED,
    ListingStatus.USER_CANCELLED,
  ],
  [ListingStatus.DRAFT_READY]: [ListingStatus.USER_VALIDATED, ListingStatus.USER_CANCELLED],
  [ListingStatus.USER_VALIDATED]: [ListingStatus.QUEUED],
  [ListingStatus.QUEUED]: [
    ListingStatus.PUBLISHED,
    ListingStatus.PUBLISH_FAILED,
    ListingStatus.USER_CANCELLED,
  ],
  [ListingStatus.PUBLISHED]: [ListingStatus.EXPIRED],
  // États terminaux
  [ListingStatus.AI_FAILED]: [],
  [ListingStatus.USER_CANCELLED]: [],
  [ListingStatus.PUBLISH_FAILED]: [],
  [ListingStatus.EXPIRED]: [],
}

export const canTransition = (from: ListingStatus, to: ListingStatus): boolean =>
  LISTING_TRANSITIONS[from].includes(to)

/** États depuis lesquels l'utilisateur peut annuler — tous pré-commit (0 débit). */
export const CANCELLABLE_STATUSES: readonly ListingStatus[] = Object.entries(LISTING_TRANSITIONS)
  .filter(([, targets]) => targets.includes(ListingStatus.USER_CANCELLED))
  .map(([from]) => from as ListingStatus)
