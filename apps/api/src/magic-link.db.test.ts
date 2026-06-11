import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * Test e2e magic link sur Postgres réel.
 * Le ConsoleEmailService renvoie le lien dans la réponse dev (devLink) —
 * on en extrait le token pour vérifier le flux complet sans SMTP.
 */
const DB_URL = process.env.DATABASE_URL
const EMAIL = 'magic-test@flipsync.fr'

const tokenFromLink = (link: string): string => {
  const t = new URL(link).searchParams.get('token')
  if (!t) throw new Error('no token in link')
  return t
}

describe.skipIf(!DB_URL)('Magic link — e2e', () => {
  let app: FastifyInstance
  let prismaRef: typeof import('@flipsync/db').prisma

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    process.env.NODE_ENV = 'test' // pas 'production' → devLink exposé

    const { prisma } = await import('@flipsync/db')
    prismaRef = prisma
    await prisma.magicLinkToken.deleteMany({ where: { email: EMAIL } })

    const { buildApp } = await import('./app')
    app = await buildApp()
  })

  afterAll(async () => {
    await app.close()
  })

  const requestLink = async (email = EMAIL): Promise<string> => {
    const res = await app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email } })
    expect(res.statusCode).toBe(200)
    return (res.json() as { devLink: string }).devLink
  }

  it('request → 200 { sent: true } et un token hashé en base', async () => {
    const link = await requestLink()
    expect(link).toContain('token=')

    const tokens = await prismaRef.magicLinkToken.findMany({ where: { email: EMAIL } })
    expect(tokens).toHaveLength(1)
    // Le token brut n'est jamais stocké : la base ne contient qu'un sha256 (64 hex).
    expect(tokens[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(tokens[0]?.tokenHash).not.toBe(tokenFromLink(link))
  })

  it('verify → JWT exploitable sur /wallet, user + wallet créés', async () => {
    const token = tokenFromLink(await requestLink())
    const res = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } })

    expect(res.statusCode).toBe(200)
    const { token: jwt, email } = res.json() as { token: string; email: string }
    expect(email).toBe(EMAIL)

    const wallet = await app.inject({
      method: 'GET',
      url: '/wallet',
      headers: { authorization: `Bearer ${jwt}` },
    })
    expect(wallet.statusCode).toBe(200)
    expect(wallet.json()).toMatchObject({ freeListingsRemaining: 3 })
  })

  it('token rejoué → 401 TOKEN_ALREADY_USED (usage unique)', async () => {
    const token = tokenFromLink(await requestLink())
    const first = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } })
    expect(first.statusCode).toBe(200)

    const replay = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } })
    expect(replay.statusCode).toBe(401)
    expect(replay.json()).toEqual({ error: 'TOKEN_ALREADY_USED' })
  })

  it('token inconnu → 401 INVALID_TOKEN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify',
      payload: { token: 'pas-un-vrai-token' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'INVALID_TOKEN' })
  })

  it('token expiré → 401 TOKEN_EXPIRED', async () => {
    await requestLink()
    // Forcer l'expiration en base.
    await prismaRef.magicLinkToken.updateMany({
      where: { email: EMAIL, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const token = tokenFromLink(await getActiveLinkAfterExpiry())

    async function getActiveLinkAfterExpiry(): Promise<string> {
      // request() purge les non consommés et en recrée un — donc on expire CELUI-CI.
      const fresh = await app.inject({
        method: 'POST',
        url: '/auth/magic-link',
        payload: { email: EMAIL },
      })
      const link = (fresh.json() as { devLink: string }).devLink
      await prismaRef.magicLinkToken.updateMany({
        where: { email: EMAIL, consumedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      return link
    }

    const res = await app.inject({ method: 'POST', url: '/auth/verify', payload: { token } })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'TOKEN_EXPIRED' })
  })

  it('nouvelle demande invalide le lien précédent (un seul lien actif)', async () => {
    const firstToken = tokenFromLink(await requestLink())
    await requestLink() // invalide le précédent

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify',
      payload: { token: firstToken },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'INVALID_TOKEN' })
  })
})
