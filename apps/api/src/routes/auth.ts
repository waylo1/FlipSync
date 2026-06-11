import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '@flipsync/db'
import { ConsoleEmailService, EmailService, TransactionalEmailService } from '../services/email.service'
import { MagicLinkService } from '../services/magic-link.service'

const emailBody = z.object({ email: z.string().email() })
const verifyBody = z.object({ token: z.string().min(1) })

const isProd = process.env.NODE_ENV === 'production'

/** Provider email : transactionnel si configuré, sinon console (dev). */
function buildEmailService(): EmailService {
  const apiKey = process.env.EMAIL_API_KEY
  const from = process.env.EMAIL_FROM
  if (apiKey && from) return new TransactionalEmailService(apiKey, from)
  return new ConsoleEmailService()
}

/**
 * Routes /auth — authentification production par magic link (sans mot de passe).
 *
 *  POST /auth/magic-link { email } → envoie un lien (réponse 200 systématique,
 *       anti-énumération : ne révèle jamais si l'email a un compte).
 *  POST /auth/verify     { token } → échange le token contre un JWT FlipSync.
 *  POST /auth/dev-token  { email } → DEV uniquement (absent en production).
 */
const authRoutes: FastifyPluginAsync = async app => {
  const magicLink = new MagicLinkService(
    prisma,
    buildEmailService(),
    userId => app.jwt.sign({ sub: userId }),
    {
      ttlMinutes: Number(process.env.MAGIC_LINK_TTL_MINUTES ?? 15),
      redirectBaseUrl: process.env.MAGIC_LINK_REDIRECT_URL ?? 'flipsync://auth/verify',
    },
  )

  app.post('/magic-link', async (req, reply) => {
    const body = emailBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const { link } = await magicLink.request(body.data.email)

    // Réponse uniforme : on ne divulgue jamais l'existence du compte.
    // En dev seulement, on renvoie le lien pour faciliter les tests manuels.
    if (!isProd) return { sent: true, devLink: link }
    return { sent: true }
  })

  app.post('/verify', async (req, reply) => {
    const body = verifyBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    try {
      return await magicLink.verify(body.data.token)
    } catch (err) {
      const code = err instanceof Error ? err.message : 'INVALID_TOKEN'
      return reply.code(401).send({ error: code })
    }
  })

  // ─── Dev uniquement ──────────────────────────────────────────────────────
  if (isProd) return

  app.post('/dev-token', async (req, reply) => {
    const body = emailBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const user = await prisma.user.upsert({
      where: { email: body.data.email },
      update: {},
      create: { email: body.data.email, wallet: { create: {} } },
    })
    return { token: app.jwt.sign({ sub: user.id }), userId: user.id, email: user.email }
  })
}

export default authRoutes
