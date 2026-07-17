import type { FastifyBaseLogger } from 'fastify'
import { Marketplace, type PartnerCredentials, type PartnerPublishResult } from '@flipsync/marketplace'
import type { ConnectorState, MarketplaceConnection, MarketplaceConnectionState } from '@flipsync/core'

/**
 * Résultat de résolution des credentials partenaire — jamais un token expiré
 * n'est retourné (fail-fast local plutôt qu'un 401 distant).
 */
export type CredentialResolution =
  | { ok: true; credentials: PartnerCredentials & { marketplace: Marketplace }; mock: boolean }
  | { ok: false; reason: 'MISSING' | 'EXPIRED' }

/**
 * Variables d'env par plateforme (compte partenaire global — cf. note classe).
 * Couvre le flux v1 (LBC/Vinted) uniquement : EBAY/SHOPIFY (ADR-009) passeront
 * par le Core Sync Engine — ici ils résolvent MISSING / DISCONNECTED.
 */
const ENV_KEYS = {
  [Marketplace.VINTED]: { token: 'VINTED_ACCESS_TOKEN', expiresAt: 'VINTED_TOKEN_EXPIRES_AT' },
  [Marketplace.LEBONCOIN]: {
    token: 'LEBONCOIN_ACCESS_TOKEN',
    expiresAt: 'LEBONCOIN_TOKEN_EXPIRES_AT',
  },
} as const

const envKeys = (marketplace: Marketplace) =>
  marketplace in ENV_KEYS ? ENV_KEYS[marketplace as keyof typeof ENV_KEYS] : null

/** Codes connecteur signant un refus d'authentification par la plateforme. */
const AUTH_REJECTED_CODE = /_HTTP_40[13]$/

/**
 * MarketplaceAuthService — SSOT des credentials partenaires et de l'état de
 * connexion aux plateformes. Toute lecture d'env marketplace passe ici (plus
 * de duplication plugins/services ↔ routes/admin).
 *
 * Aujourd'hui : compte partenaire global via env (les programmes Vinted
 * Integrations / LBC Partenaire sont sous contrat, credentials fournis à
 * l'onboarding — cf. Sprint 3). Demain : table par user/plateforme derrière la
 * même interface. Le refresh token réel attend la doc partenaire (sémantique
 * OAuth inconnue tant que l'accès programme n'est pas accordé) ; l'expiration,
 * elle, est déjà détectée via *_TOKEN_EXPIRES_AT.
 *
 * `lastAuthError` est en mémoire (même choix que le job store IA) : un
 * redémarrage repart sain, le prochain publish re-détecte un credential refusé.
 */
export class MarketplaceAuthService {
  private readonly lastAuthError = new Map<Marketplace, string>()

  constructor(private readonly log?: FastifyBaseLogger) {}

  /** Mode mock global (jamais en production) — cf. plugins/services.ts. */
  mockEnabled(): boolean {
    return process.env.MARKETPLACE_MOCK === '1' && process.env.NODE_ENV !== 'production'
  }

  /**
   * Credentials du vendeur pour une plateforme. Lecture paresseuse de l'env
   * (jamais figée au boot : tests et outils la modifient). `_userId` : couture
   * pour les credentials par user (OAuth partenaire) sans changer l'appelant.
   */
  resolve(_userId: string, marketplace: Marketplace): CredentialResolution {
    if (this.mockEnabled()) {
      return {
        ok: true,
        mock: true,
        credentials: { marketplace, accessToken: 'mock-access-token', sellerId: 'mock-seller' },
      }
    }

    const keys = envKeys(marketplace)
    const token = keys ? process.env[keys.token] : undefined
    if (!token) {
      this.log?.warn({ marketplace }, 'credentials partenaire absents — publication impossible')
      return { ok: false, reason: 'MISSING' }
    }
    if (this.expired(marketplace)) {
      this.log?.warn({ marketplace }, 'credentials partenaire expirés — publication impossible')
      return { ok: false, reason: 'EXPIRED' }
    }
    return {
      ok: true,
      mock: false,
      credentials: { marketplace, accessToken: token, sellerId: process.env.MARKETPLACE_SELLER_ID },
    }
  }

  /**
   * À appeler après chaque tentative de publication : un refus d'auth
   * plateforme (HTTP 401/403) marque le connecteur AUTH_ERROR ; un succès
   * l'efface. Les autres échecs (réseau, 5xx) ne présument rien de l'auth.
   */
  reportPublishOutcome(marketplace: Marketplace, result: PartnerPublishResult): void {
    if (result.ok) {
      this.lastAuthError.delete(marketplace)
    } else if (AUTH_REJECTED_CODE.test(result.code)) {
      this.lastAuthError.set(marketplace, result.code)
      this.log?.warn({ marketplace, code: result.code }, 'authentification refusée par la plateforme')
    }
  }

  /**
   * Le mock (MARKETPLACE_MOCK=1) couvre UNIQUEMENT Vinted/LBC (cf.
   * publication.service.ts) : EBAY/SHOPIFY ont des connecteurs réels qui lisent
   * déjà leur propre config env sans avoir besoin d'être mockés.
   */
  private mockAppliesTo(marketplace: Marketplace): boolean {
    return this.mockEnabled() && envKeys(marketplace) !== null
  }

  /** État de connexion d'une plateforme — contrat GET /marketplace/status. */
  connection(marketplace: Marketplace): MarketplaceConnection {
    return {
      marketplace,
      state: this.connectionState(marketplace),
      mock: this.mockAppliesTo(marketplace),
      detail: this.lastAuthError.get(marketplace) ?? null,
    }
  }

  /** États des 4 plateformes, ordre stable VINTED, LEBONCOIN, EBAY, SHOPIFY. */
  status(): MarketplaceConnection[] {
    return [
      this.connection(Marketplace.VINTED),
      this.connection(Marketplace.LEBONCOIN),
      this.connection(Marketplace.EBAY),
      this.connection(Marketplace.SHOPIFY),
    ]
  }

  /** Projection admin (AdminOverview.marketplace) — MOCK/LIVE au lieu de CONNECTED. */
  connectorState(marketplace: Marketplace): ConnectorState {
    if (this.mockAppliesTo(marketplace)) return 'MOCK'
    const state = this.connectionState(marketplace)
    switch (state) {
      case 'CONNECTED':
        return 'LIVE'
      case 'DISCONNECTED':
        return 'MISSING'
      default:
        return state // EXPIRED | AUTH_ERROR — mêmes valeurs dans les deux contrats
    }
  }

  private connectionState(marketplace: Marketplace): MarketplaceConnectionState {
    if (this.mockAppliesTo(marketplace)) return 'CONNECTED'
    const keys = envKeys(marketplace)
    if (!keys || !process.env[keys.token]) return 'DISCONNECTED'
    if (this.expired(marketplace)) return 'EXPIRED'
    if (this.lastAuthError.has(marketplace)) return 'AUTH_ERROR'
    return 'CONNECTED'
  }

  /**
   * Expiration optionnelle du token (*_TOKEN_EXPIRES_AT, date ISO). Date
   * illisible → considérée expirée (fail-closed : on n'envoie jamais un token
   * dont on ne sait pas lire l'échéance).
   */
  private expired(marketplace: Marketplace): boolean {
    const keys = envKeys(marketplace)
    const raw = keys ? process.env[keys.expiresAt] : undefined
    if (!raw) return false
    const expiresAt = Date.parse(raw)
    if (Number.isNaN(expiresAt)) {
      this.log?.warn({ marketplace, raw }, 'TOKEN_EXPIRES_AT illisible — token traité comme expiré')
      return true
    }
    return expiresAt <= Date.now()
  }
}
