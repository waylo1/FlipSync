import fp from 'fastify-plugin'
import { FastifyPluginAsync } from 'fastify'
import { WalletError } from '@flipsync/wallet'
import { EngineError } from '@flipsync/ai'
import { PublicationError } from '../services/publication.service'

/** Mapping code métier SNAKE_CASE → statut HTTP. Défaut domaine : 400. */
const HTTP_BY_CODE: Readonly<Record<string, number>> = {
  WALLET_NOT_FOUND: 404,
  LISTING_NOT_FOUND: 404,
  INSUFFICIENT_FUNDS: 402,
  NO_FREE_CREDIT: 402,
  INVALID_TRANSITION: 409,
  INVALID_LISTING_STATE: 409,
  ALREADY_COMMITTED: 409,
  INVALID_AMOUNT: 400,
  INVALID_PAYMENT_SOURCE: 400,
  MISSING_FAILURE_REASON: 400,
}

/**
 * Toutes les erreurs sortent au format { error: 'SNAKE_CASE_CODE' } (cf. conventions).
 * Aucune donnée financière ni stack trace n'est exposée au client.
 */
const errorHandlerPlugin: FastifyPluginAsync = async app => {
  app.setErrorHandler((err, req, reply) => {
    if (
      err instanceof WalletError ||
      err instanceof EngineError ||
      err instanceof PublicationError
    ) {
      return reply.code(HTTP_BY_CODE[err.code] ?? 400).send({ error: err.code })
    }

    // Erreurs de validation Fastify (schémas) — peu probable ici, zod gère les bodies.
    if (err.validation) {
      return reply.code(400).send({ error: 'INVALID_BODY' })
    }

    // @fastify/rate-limit lève une erreur statusCode 429 — normalisée SNAKE_CASE.
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: 'RATE_LIMITED' })
    }

    req.log.error({ err }, 'unhandled error')
    return reply.code(500).send({ error: 'INTERNAL_ERROR' })
  })
}

export default fp(errorHandlerPlugin, { name: 'error-handler-plugin' })
