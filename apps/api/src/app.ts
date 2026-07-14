import { mkdir } from 'node:fs/promises'
import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import authPlugin from './plugins/auth'
import servicesPlugin from './plugins/services'
import errorHandlerPlugin from './plugins/error-handler'
import metricsPlugin from './plugins/metrics'
import walletRoutes from './routes/wallet'
import listingRoutes, { UPLOAD_DIR } from './routes/listing'
import stripeRoutes from './routes/stripe'
import authRoutes from './routes/auth'
import aiRoutes from './routes/ai'
import adminRoutes from './routes/admin'
import devSessionsRoutes from './routes/dev-sessions'
import marketplaceRoutes from './routes/marketplace'
import missionRoutes from './routes/mission'
import notificationRoutes from './routes/notification'
import webhookRoutes from './routes/webhook'

/** Construit l'app complète — utilisé par index.ts (listen) et les tests (inject). */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      // Ne jamais logger de données financières en clair (cf. rules.md).
      redact: ['req.headers.authorization'],
    },
    // Derrière un reverse proxy (prod) : l'IP client vient de X-Forwarded-For —
    // indispensable pour un rate limiting par IP réelle.
    trustProxy: process.env.TRUST_PROXY === '1',
  })

  // CORS : whitelist via CORS_ORIGINS (séparées par des virgules). Sans liste :
  // tout est accepté hors production (DX), tout est refusé en production —
  // l'app mobile native n'envoie pas d'Origin et n'est donc jamais affectée.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)
  await app.register(cors, {
    origin: corsOrigins.length > 0 ? corsOrigins : process.env.NODE_ENV !== 'production',
  })
  await app.register(authPlugin)
  await app.register(servicesPlugin)
  await app.register(errorHandlerPlugin)
  await app.register(metricsPlugin)

  // /health — seule route publique sans vérification (pas de JWT).
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

  // Photos uploadées — servies statiquement (URLs stockées dans ListingPhoto.url).
  // Accès réservé aux utilisateurs authentifiés : le mobile doit envoyer le JWT
  // (Image source={{ uri, headers }}), les connecteurs marketplace reçoivent des
  // URLs qu'eux seuls consomment côté serveur.
  await mkdir(UPLOAD_DIR, { recursive: true })
  await app.register(async uploads => {
    uploads.addHook('onRequest', app.authenticate)
    await uploads.register(fastifyStatic, { root: UPLOAD_DIR, prefix: '/uploads/' })
  })

  // Routes protégées JWT. Exceptions : /stripe/webhook (signature Stripe),
  // /webhooks/vendu (signatures plateformes — HMAC Shopify / ECDSA eBay)
  // et /auth/dev-token (dev uniquement, absent en production).
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(walletRoutes, { prefix: '/wallet' })
  await app.register(listingRoutes, { prefix: '/listing' })
  await app.register(stripeRoutes, { prefix: '/stripe' })
  await app.register(aiRoutes, { prefix: '/ai' })
  await app.register(adminRoutes, { prefix: '/admin' })
  await app.register(devSessionsRoutes, { prefix: '/dev-sessions' })
  await app.register(marketplaceRoutes, { prefix: '/marketplace' })
  await app.register(missionRoutes, { prefix: '/mission' })
  await app.register(notificationRoutes, { prefix: '/notifications' })
  await app.register(webhookRoutes, { prefix: '/webhooks' })

  return app
}
