import fp from 'fastify-plugin'
import { FastifyPluginAsync } from 'fastify'
import { prisma } from '@flipsync/db'
import { WalletService } from '@flipsync/wallet'
import { ListingEngine, VisionService, createVisionBackend } from '@flipsync/ai'
import { join } from 'node:path'
import { PublicationService } from '../services/publication.service'
import { MarketplaceAuthService } from '../services/marketplace-auth.service'
import { MissionService } from '../services/mission.service'
import { MissionNegotiationService } from '../services/negotiation.service'
import { ConsoleNotificationService, ExpoNotificationService, NotificationService } from '../services/notification.service'

declare module 'fastify' {
  interface FastifyInstance {
    walletService: WalletService
    listingEngine: ListingEngine
    publicationService: PublicationService
    visionService: VisionService
    marketplaceAuth: MarketplaceAuthService
    missionService: MissionService
    missionNegotiationService: MissionNegotiationService
  }
}

/**
 * Pivot IA serveur : la rédaction du brouillon tourne côté API (Ollama en dev,
 * API Anthropic en prod) — le mobile envoie les photos et reçoit le brouillon.
 * Timeout large : modèle vision 3B sur CPU, 30-90 s réalistes en dev.
 */
const SERVER_VISION_TIMEOUT_MS = 120_000

/** Injection des services métier — une seule instance Prisma partagée. */
const servicesPlugin: FastifyPluginAsync = async app => {
  const walletService = new WalletService(prisma)
  const listingEngine = new ListingEngine(prisma, walletService)

  // SSOT credentials partenaires + états de connexion (env aujourd'hui,
  // table par user demain) — cf. services/marketplace-auth.service.ts.
  const marketplaceAuth = new MarketplaceAuthService(app.log)

  /**
   * Mode mock (MARKETPLACE_MOCK=1, jamais en production) : Vinted/LBC sont
   * remplacés par MockMarketplacePublisher (natif ChannelConnector, C3.6) qui
   * journalise dans debug/publish_log.json — permet de valider le pipeline
   * complet sans credentials partenaires ni device mobile (cf. tools/test-pipeline.ts).
   * Le registre (mock ou réel) est construit PAR REQUÊTE dans PublicationService.
   */
  const useMock = marketplaceAuth.mockEnabled()
  const mockLogPath =
    process.env.MOCK_PUBLISH_LOG ?? join(process.cwd(), 'debug', 'publish_log.json')
  if (useMock) app.log.warn({ mockLogPath }, 'MARKETPLACE_MOCK actif — publications simulées')
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001'

  app.decorate('walletService', walletService)
  app.decorate('listingEngine', listingEngine)
  // Ollama en dev, API Anthropic dès qu'ANTHROPIC_API_KEY est posée. Le
  // sélecteur refuse de démarrer en prod sans clé — cf. createVisionBackend.
  app.decorate('visionService', new VisionService(createVisionBackend(), SERVER_VISION_TIMEOUT_MS))
  app.decorate('marketplaceAuth', marketplaceAuth)
  app.decorate(
    'publicationService',
    new PublicationService(prisma, listingEngine, publicBaseUrl, marketplaceAuth, mockLogPath, app.log),
  )
  app.decorate('missionService', new MissionService(prisma))
  // Notifications §7 (Lot 9) : ExpoNotificationService envoie un vrai push aux
  // devices enregistrés (table DeviceToken, cf. routes/notification.ts) — no-op
  // silencieux tant qu'aucun device n'est enregistré, donc sûr en dev/test sans
  // rien de plus à configurer. PUSH_LOG_ONLY=1 revient au logging console pur
  // (utile en CI/offline pour éviter tout appel réseau vers l'API Expo Push).
  const notificationService: NotificationService =
    process.env.PUSH_LOG_ONLY === '1'
      ? new ConsoleNotificationService(app.log.info.bind(app.log))
      : new ExpoNotificationService(prisma, app.log.warn.bind(app.log))
  app.decorate('missionNegotiationService', new MissionNegotiationService(prisma, notificationService))

  app.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
}

export default fp(servicesPlugin, { name: 'services-plugin' })
