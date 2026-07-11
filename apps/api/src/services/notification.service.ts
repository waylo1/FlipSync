import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'
import type { PrismaClient } from '@flipsync/db'
import { NotificationContent, NotificationKind, notificationContent } from '@flipsync/core'

/**
 * Abstraction d'envoi de notification (§7, Lot 8/9). En dev/test :
 * ConsoleNotificationService logge le texte (aucun device token requis). En
 * prod : ExpoNotificationService envoie un vrai push via Expo Push API aux
 * devices enregistrés (table DeviceToken). Même interface des deux côtés,
 * MissionNegotiationService ne sait pas lequel est branché. La décision
 * anti-spam (`shouldNotify`, @flipsync/core) reste hors de ce service : il ne
 * fait qu'envoyer ce qu'on lui demande d'envoyer.
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

/**
 * Prod : envoie un vrai push via l'API Expo Push aux devices enregistrés pour
 * `userId` (table DeviceToken). Silencieux si aucun device n'est enregistré —
 * un user qui n'a jamais ouvert l'app mobile n'a simplement pas de token, ce
 * n'est pas une erreur. Les tokens qu'Expo signale invalides/désinstallés
 * (`DeviceNotRegistered`) sont supprimés pour ne pas les retenter en boucle.
 */
export class ExpoNotificationService implements NotificationService {
  private readonly expo = new Expo()

  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: (msg: string, meta?: unknown) => void = console.log,
  ) {}

  async send(userId: string, content: NotificationContent): Promise<void> {
    const devices = await this.prisma.deviceToken.findMany({ where: { userId } })
    if (devices.length === 0) return

    const messages: ExpoPushMessage[] = devices
      .filter(d => Expo.isExpoPushToken(d.token))
      .map(d => ({
        to: d.token,
        title: 'FlipSync',
        body: content.text,
        sound: 'default',
        data: { kind: content.kind },
      }))
    if (messages.length === 0) return

    const chunks = this.expo.chunkPushNotifications(messages)
    const tickets: ExpoPushTicket[] = []
    for (const chunk of chunks) {
      try {
        tickets.push(...(await this.expo.sendPushNotificationsAsync(chunk)))
      } catch (err) {
        this.log('expo push chunk failed', err)
      }
    }

    const deadTokens = tickets
      .map((ticket, i) => ({ ticket, token: messages[i]?.to as string | undefined }))
      .filter(({ ticket }) => ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered')
      .map(({ token }) => token)
      .filter((t): t is string => t !== undefined)
    if (deadTokens.length > 0) {
      await this.prisma.deviceToken.deleteMany({ where: { token: { in: deadTokens } } })
    }
  }
}

/** Construit le contenu §7 pour un événement de négociation donné. */
export function buildNotification(kind: NotificationKind, objet: string, amountCents?: number): NotificationContent {
  return notificationContent(kind, objet, amountCents)
}
