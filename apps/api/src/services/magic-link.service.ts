import { createHash, randomBytes } from 'node:crypto'
import { PrismaClient } from '@flipsync/db'
import { EmailService } from './email.service'

/** sha256 hex du token brut — seul le hash est stocké en base. */
const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex')

export interface MagicLinkConfig {
  /** Durée de validité d'un lien, en minutes. */
  ttlMinutes: number
  /** Base du lien envoyé par email (deep link app ou page web de redirection). */
  redirectBaseUrl: string
}

export interface VerifyResult {
  token: string // JWT FlipSync
  userId: string
  email: string
}

/**
 * MagicLinkService — authentification sans mot de passe.
 *
 * Sécurité :
 *  - Le token brut (32 octets aléatoires) n'est JAMAIS stocké : seul son sha256.
 *  - Usage unique (consumedAt) + expiration courte (ttlMinutes).
 *  - request() ne révèle jamais si l'email existe (anti-énumération) : c'est
 *    l'appelant (route) qui répond 200 systématiquement.
 *  - Les tokens non consommés précédents pour un email sont invalidés à chaque
 *    nouvelle demande (un seul lien actif à la fois).
 */
export class MagicLinkService {
  constructor(
    private readonly db: PrismaClient,
    private readonly email: EmailService,
    private readonly signJwt: (userId: string) => string,
    private readonly config: MagicLinkConfig,
  ) {}

  /**
   * Crée un token et envoie le lien. Retourne le lien UNIQUEMENT pour faciliter
   * les tests / le dev — la route ne l'expose pas en production.
   */
  async request(email: string, now: Date = new Date()): Promise<{ link: string }> {
    const normalized = email.trim().toLowerCase()

    // Un seul lien actif : on invalide les précédents non consommés.
    await this.db.magicLinkToken.deleteMany({
      where: { email: normalized, consumedAt: null },
    })

    const raw = randomBytes(32).toString('base64url')
    const expiresAt = new Date(now.getTime() + this.config.ttlMinutes * 60_000)

    await this.db.magicLinkToken.create({
      data: { email: normalized, tokenHash: hashToken(raw), expiresAt },
    })

    const link = `${this.config.redirectBaseUrl}?token=${raw}`
    await this.email.sendMagicLink(normalized, link)
    return { link }
  }

  /**
   * Vérifie un token brut : doit exister, non expiré, non consommé.
   * Marque consommé (atomique), upsert l'utilisateur (+ wallet par défaut) et
   * signe le JWT. Codes d'échec : INVALID_TOKEN, TOKEN_EXPIRED, TOKEN_ALREADY_USED.
   */
  async verify(rawToken: string, now: Date = new Date()): Promise<VerifyResult> {
    const record = await this.db.magicLinkToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    })
    if (!record) throw new Error('INVALID_TOKEN')
    if (record.consumedAt) throw new Error('TOKEN_ALREADY_USED')
    if (record.expiresAt <= now) throw new Error('TOKEN_EXPIRED')

    // Consommation atomique : updateMany conditionné à consumedAt=null gagne la course.
    const consumed = await this.db.magicLinkToken.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: now },
    })
    if (consumed.count === 0) throw new Error('TOKEN_ALREADY_USED')

    const user = await this.db.user.upsert({
      where: { email: record.email },
      update: {},
      create: { email: record.email, wallet: { create: {} } },
    })

    return { token: this.signJwt(user.id), userId: user.id, email: user.email }
  }
}
