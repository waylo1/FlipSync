/**
 * Abstraction d'envoi d'email — un seul cas d'usage pour l'instant : le magic link.
 * En dev : ConsoleEmailService logge le lien (aucun SMTP requis).
 * En prod : brancher un vrai provider (Resend / Postmark / SES) derrière la même
 * interface, sans toucher au MagicLinkService.
 */
export interface EmailService {
  sendMagicLink(email: string, link: string): Promise<void>
}

/** Dev / test : écrit le lien dans les logs. Ne JAMAIS utiliser en production. */
export class ConsoleEmailService implements EmailService {
  constructor(private readonly log: (msg: string) => void = console.log) {}

  async sendMagicLink(email: string, link: string): Promise<void> {
    this.log(`[magic-link] → ${email} : ${link}`)
  }
}

/**
 * Placeholder provider transactionnel (Resend par défaut).
 * TODO(prod) : renseigner EMAIL_API_KEY + EMAIL_FROM et compléter le payload
 * selon la doc du provider retenu.
 */
export class TransactionalEmailService implements EmailService {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly endpoint = process.env.EMAIL_API_URL ?? 'https://api.resend.com/emails',
  ) {}

  async sendMagicLink(email: string, link: string): Promise<void> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: email,
        subject: 'Votre lien de connexion FlipSync',
        text: `Connectez-vous en ouvrant ce lien (valable 15 minutes) : ${link}`,
      }),
    })
    if (!res.ok) throw new Error(`EMAIL_SEND_FAILED_${res.status}`)
  }
}
