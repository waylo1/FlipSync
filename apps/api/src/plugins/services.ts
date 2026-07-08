import fp from 'fastify-plugin'
import { FastifyPluginAsync } from 'fastify'
import { prisma } from '@flipsync/db'
import { WalletService } from '@flipsync/wallet'
import { ListingEngine, OllamaVisionBackend, VisionService } from '@flipsync/ai'
import { join } from 'node:path'
import {
  MarketplaceClient,
  Marketplace,
  MarketplaceCredentials,
  MockMarketplacePublisher,
} from '@flipsync/marketplace'
import { PublicationService, CredentialsResolver } from '../services/publication.service'

declare module 'fastify' {
  interface FastifyInstance {
    walletService: WalletService
    listingEngine: ListingEngine
    publicationService: PublicationService
    visionService: VisionService
  }
}

/**
 * Pivot IA serveur : la rédaction du brouillon tourne côté API (Ollama en dev,
 * instance dédiée en prod) — le mobile envoie les photos et reçoit le brouillon.
 * Timeout large : modèle vision 3B sur CPU, 30-90 s réalistes en dev.
 */
const SERVER_VISION_TIMEOUT_MS = 120_000

/**
 * Résout les identifiants partenaire du vendeur.
 * TODO(partenaire) : table MarketplaceAccount (token OAuth par user/plateforme).
 * Pour l'instant : variables d'env globales (compte partenaire unique de dev).
 * Token absent → null → PUBLISH_FAILED(MARKETPLACE_CREDENTIALS_MISSING) + remboursement.
 */
const envCredentialsResolver: CredentialsResolver = async (_userId, marketplace) => {
  const token =
    marketplace === Marketplace.VINTED
      ? process.env.VINTED_ACCESS_TOKEN
      : process.env.LEBONCOIN_ACCESS_TOKEN
  if (!token) return null

  const credentials: MarketplaceCredentials = {
    marketplace,
    accessToken: token,
    sellerId: process.env.MARKETPLACE_SELLER_ID,
  }
  return credentials
}

/**
 * Mode mock (MARKETPLACE_MOCK=1, jamais en production) : les connecteurs réels
 * sont remplacés par MockMarketplacePublisher qui journalise dans
 * debug/publish_log.json — permet de valider le pipeline complet sans
 * credentials partenaires ni device mobile (cf. tools/test-pipeline.ts).
 */
const marketplaceMockEnabled = () =>
  process.env.MARKETPLACE_MOCK === '1' && process.env.NODE_ENV !== 'production'

const mockCredentialsResolver: CredentialsResolver = async (_userId, marketplace) => ({
  marketplace,
  accessToken: 'mock-access-token',
  sellerId: 'mock-seller',
})

/** Injection des services métier — une seule instance Prisma partagée. */
const servicesPlugin: FastifyPluginAsync = async app => {
  const walletService = new WalletService(prisma)
  const listingEngine = new ListingEngine(prisma, walletService)

  const useMock = marketplaceMockEnabled()
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
  app.decorate(
    'publicationService',
    new PublicationService(
      prisma,
      listingEngine,
      marketplaceClient,
      publicBaseUrl,
      useMock ? mockCredentialsResolver : envCredentialsResolver,
    ),
  )

  app.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
}

export default fp(servicesPlugin, { name: 'services-plugin' })
