import fp from 'fastify-plugin'
import { FastifyPluginAsync } from 'fastify'
import { prisma } from '@flipsync/db'
import { WalletService } from '@flipsync/wallet'
import { ListingEngine, OllamaVisionBackend, VisionService } from '@flipsync/ai'
import { join } from 'node:path'
import { MarketplaceClient, Marketplace, MockMarketplacePublisher } from '@flipsync/marketplace'
import { PublicationService } from '../services/publication.service'
import { MarketplaceAuthService } from '../services/marketplace-auth.service'
import { MissionService } from '../services/mission.service'
import { MissionNegotiationService } from '../services/negotiation.service'
import { ConsoleNotificationService } from '../services/notification.service'

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
 * instance dédiée en prod) — le mobile envoie les photos et reçoit le brouillon.
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
   * Mode mock (MARKETPLACE_MOCK=1, jamais en production) : les connecteurs réels
   * sont remplacés par MockMarketplacePublisher qui journalise dans
   * debug/publish_log.json — permet de valider le pipeline complet sans
   * credentials partenaires ni device mobile (cf. tools/test-pipeline.ts).
   */
  const useMock = marketplaceAuth.mockEnabled()
  const mockLogPath =
    process.env.MOCK_PUBLISH_LOG ?? join(process.cwd(), 'debug', 'publish_log.json')
  const marketplaceClient = useMock
    ? new MarketplaceClient([
        new MockMarketplacePublisher(Marketplace.VINTED, mockLogPath),
        new MockMarketplacePublisher(Marketplace.LEBONCOIN, mockLogPath),
      ])
    : new MarketplaceClient()
  if (useMock) app.log.warn({ mockLogPath }, 'MARKETPLACE_MOCK actif — publications simulées')
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001'

  app.decorate('walletService', walletService)
  app.decorate('listingEngine', listingEngine)
  app.decorate('visionService', new VisionService(new OllamaVisionBackend(), SERVER_VISION_TIMEOUT_MS))
  app.decorate('marketplaceAuth', marketplaceAuth)
  app.decorate(
    'publicationService',
    new PublicationService(prisma, listingEngine, marketplaceClient, publicBaseUrl, marketplaceAuth, app.log),
  )
  app.decorate('missionService', new MissionService(prisma))
  // Notifications §7 : ConsoleNotificationService partout pour l'instant — aucun
  // provider push réel n'est branché (pas de device token, pas de SDK Expo Push
  // installé). L'anti-spam (shouldNotify, @flipsync/core) et les textes exacts
  // sont en place et testés ; brancher un vrai provider derrière la même
  // interface NotificationService n'affectera pas MissionNegotiationService.
  app.decorate('missionNegotiationService', new MissionNegotiationService(prisma, new ConsoleNotificationService(app.log.info.bind(app.log))))

  app.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
}

export default fp(servicesPlugin, { name: 'services-plugin' })
