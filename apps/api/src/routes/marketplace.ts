import { FastifyPluginAsync } from 'fastify'
import type { MarketplaceStatusResponse } from '@flipsync/core'

/**
 * Routes /marketplace — état des connexions plateformes pour le mobile
 * (écran profil : Connecté / Déconnecté / Expiré / Erreur d'authentification).
 * Compte partenaire global aujourd'hui : le même état vaut pour tous les users.
 */
const marketplaceRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', app.authenticate)

  app.get('/status', async (): Promise<MarketplaceStatusResponse> => ({
    connections: app.marketplaceAuth.status(),
  }))
}

export default marketplaceRoutes
