import { NotificationContent, NotificationKind, notificationContent } from '@flipsync/core'

/**
 * Abstraction d'envoi de notification (§7, Lot 8). En dev/test :
 * ConsoleNotificationService logge le texte (aucun device token requis, aucun
 * SDK push installé). En prod : brancher un vrai provider (Expo Push, FCM/APNs)
 * derrière la même interface, sans toucher à MissionNegotiationService. La
 * décision anti-spam (`shouldNotify`, @flipsync/core) reste hors de ce service :
 * il ne fait qu'envoyer ce qu'on lui demande d'envoyer.
 */
export interface NotificationService {
  send(userId: string, content: NotificationContent): Promise<void>
}

/** Dev / test : écrit la notification dans les logs. Ne JAMAIS utiliser en production. */
export class ConsoleNotificationService implements NotificationService {
  constructor(private readonly log: (msg: string) => void = console.log) {}

  async send(userId: string, content: NotificationContent): Promise<void> {
    this.log(`[notification:${content.kind}] → ${userId} : ${content.text}`)
  }
}

/** Construit le contenu §7 pour un événement de négociation donné. */
export function buildNotification(kind: NotificationKind, objet: string, amountCents?: number): NotificationContent {
  return notificationContent(kind, objet, amountCents)
}
