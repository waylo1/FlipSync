import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'
import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

// Payload JWT minimal : { sub: userId } uniquement (cf. gotchas.md).
interface JwtPayload {
  sub: string
}

declare module 'fastify' {
  interface FastifyRequest {
    /** userId injecté par authPlugin après vérification du JWT. */
    userId: string
  }
  interface FastifyInstance {
    /** preHandler à appliquer sur toutes les routes protégées. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload
    user: JwtPayload
  }
}

/**
 * authPlugin — enregistre @fastify/jwt et expose `authenticate`.
 * Toutes les routes sont protégées SAUF /health.
 * Erreurs normalisées : { error: 'SNAKE_CASE_CODE' }.
 */
const authPlugin: FastifyPluginAsync = async app => {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET_MISSING_OR_TOO_SHORT')
  }

  // Expiration 30 j : un token volé n'est plus éternel. Côté mobile, un 401
  // purge le JWT (MMKV) et renvoie au login magic link — re-login sans friction.
  await app.register(jwt, { secret, sign: { expiresIn: '30d' } })

  app.decorateRequest('userId', '')

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await req.jwtVerify<JwtPayload>()
      req.userId = payload.sub
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED' })
    }
  })
}

export default fp(authPlugin, { name: 'auth-plugin' })
