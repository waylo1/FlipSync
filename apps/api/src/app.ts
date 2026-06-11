import { mkdir } from 'node:fs/promises'
import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import authPlugin from './plugins/auth'
import servicesPlugin from './plugins/services'
import errorHandlerPlugin from './plugins/error-handler'
import walletRoutes from './routes/wallet'
import listingRoutes, { UPLOAD_DIR } from './routes/listing'
import stripeRoutes from './routes/stripe'
import authRoutes from './routes/auth'

/** Construit l'app complète — utilisé par index.ts (listen) et les tests (inject). */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      // Ne jamais logger de données financières en clair (cf. rules.md).
      redact: ['req.headers.authorization'],
    },
  })

  await app.register(cors, { origin: true })
  await app.register(authPlugin)
  await app.register(servicesPlugin)
  await app.register(errorHandlerPlugin)

  // /health — seule route publique sans vérification (pas de JWT).
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

  // Photos uploadées — servies statiquement (URLs stockées dans ListingPhoto.url).
  await mkdir(UPLOAD_DIR, { recursive: true })
  await app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: '/uploads/' })

  // Routes protégées JWT. Exceptions : /stripe/webhook (signature Stripe)
  // et /auth/dev-token (dev uniquement, absent en production).
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(walletRoutes, { prefix: '/wallet' })
  await app.register(listingRoutes, { prefix: '/listing' })
  await app.register(stripeRoutes, { prefix: '/stripe' })

  return app
}
