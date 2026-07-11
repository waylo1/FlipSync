import { centsToEur } from './wallet'

// ─── Commissaire-Priseur IA — Lot 8 : notifications §7 ─────────────────────────
// Pur (aucune I/O, aucun accès device) : la décision ("faut-il notifier, avec
// quel texte") est déterministe et testable ici ; l'envoi réel (push/no-op)
// vit côté service (@flipsync/api, cf. notification.service.ts).
//
// Seuls les événements réellement déclenchables par ce lot sont couverts
// (VALIDATION_REQUIRED, SECURITY_ALERT, SOLD) : « offre intéressante trouvée »,
// « vente à finaliser » et « mission expirée » du tableau §7 supposent une
// stratégie de négociation autonome et une expiration planifiée qui n'existent
// pas encore dans ce produit — les ajouter viendra avec les lots qui les
// rendent atteignables, pas avant (zéro fonctionnalité à moitié câblée).
export type NotificationKind = 'VALIDATION_REQUIRED' | 'SECURITY_ALERT' | 'SOLD'

export type NotificationTone = 'bouteille' | 'moutarde' | 'brique'

export interface NotificationContent {
  readonly kind: NotificationKind
  readonly tone: NotificationTone
  readonly text: string
}

const eur = (cents: number): string => `${centsToEur(cents).toFixed(2).replace('.', ',')} €`

/** Textes exacts §7 — jamais reformulés ailleurs. */
export function notificationContent(
  kind: NotificationKind,
  objet: string,
  amountCents?: number,
): NotificationContent {
  switch (kind) {
    case 'VALIDATION_REQUIRED':
      return { kind, tone: 'moutarde', text: `L'IA attend votre feu vert pour « ${objet} ».` }
    case 'SECURITY_ALERT':
      return { kind, tone: 'brique', text: 'Un acheteur tente de sortir du circuit sécurisé.' }
    case 'SOLD':
      return {
        kind,
        tone: 'bouteille',
        text: `Vendu ${amountCents !== undefined ? eur(amountCents) : ''} ! L'IA a conclu « ${objet} ».`,
      }
  }
}

/** Anti-spam §7 : au plus une notification de négociation par heure et par mission. */
const NEGOTIATION_KINDS: readonly NotificationKind[] = ['VALIDATION_REQUIRED', 'SECURITY_ALERT']
const THROTTLE_MS = 60 * 60 * 1000

/**
 * Décide si une notification doit partir. `SOLD` n'est jamais throttlé — c'est
 * un événement terminal, unique par mission, jamais répété. `lastNotifiedAt`
 * ne doit être mis à jour que pour les kinds régulés (cf. appelant).
 */
export function shouldNotify(kind: NotificationKind, lastNotifiedAt: Date | null, now: Date = new Date()): boolean {
  if (!NEGOTIATION_KINDS.includes(kind)) return true
  if (lastNotifiedAt === null) return true
  return now.getTime() - lastNotifiedAt.getTime() >= THROTTLE_MS
}

/** `true` si `kind` fait partie du quota anti-spam (donc met à jour `lastNotifiedAt`). */
export const isThrottledKind = (kind: NotificationKind): boolean => NEGOTIATION_KINDS.includes(kind)
