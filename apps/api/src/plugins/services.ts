import fp from 'fastify-plugin'
import { FastifyPluginAsync } from 'fastify'
import { prisma } from '@flipsync/db'
import { WalletService } from '@flipsync/wallet'
import { ListingEngine } from '@flipsync/ai'
import { MarketplaceClient, Marketplace, MarketplaceCredentials } from '@flipsync/marketplace'
import { PublicationService, CredentialsResolver } from '../services/publication.service'

declare module 'fastify' {
  interface FastifyInstance {
    walletService: WalletService
    listingEngine: ListingEngine
    publicationService: PublicationService
  }
}

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

/** Injection des services métier — une seule instance Prisma partagée. */
const servicesPlugin: FastifyPluginAsync = async app => {
  const walletService = new WalletService(prisma)
  const listingEngine = new ListingEngine(prisma, walletService)
  const marketplaceClient = new MarketplaceClient()
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001'

  app.decorate('walletService', walletService)
  app.decorate('listingEngine', listingEngine)
  app.decorate(
    'publicationService',
    new PublicationService(
      prisma,
      listingEngine,
      marketplaceClient,
      publicBaseUrl,
      envCredentialsResolver,
    ),
  )

  app.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
}

export default fp(servicesPlugin, { name: 'services-plugin' })
