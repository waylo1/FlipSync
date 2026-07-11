import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * Test e2e des routes /notifications/device-token (§7, Lot 9) : enregistrement
 * et désenregistrement des tokens Expo Push. Le comportement d'envoi réel
 * (ExpoNotificationService) n'est pas testé ici — il appellerait l'API Expo
 * Push en vrai — seule la persistance (table DeviceToken) est vérifiée.
 */
const DB_URL = process.env.DATABASE_URL

describe.skipIf(!DB_URL)('/notifications/device-token — enregistrement (e2e JWT)', () => {
  let app: FastifyInstance
  let token = ''
  let otherToken = ''
  let userId = ''

  const EMAIL = 'device-token-test@flipsync.fr'
  const OTHER_EMAIL = 'device-token-other@flipsync.fr'
  const authed = (t: string) => ({ authorization: `Bearer ${t}` })

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    process.env.AUTH_RATE_LIMIT_MAX = '1000'

    const { prisma } = await import('@flipsync/db')

    for (const email of [EMAIL, OTHER_EMAIL]) {
      const stale = await prisma.user.findUnique({ where: { email } })
      if (stale) await prisma.user.delete({ where: { id: stale.id } })
    }
    await prisma.deviceToken.deleteMany({ where: { token: { startsWith: 'ExponentPushToken[device-token-test' } } })

    const user = await prisma.user.create({ data: { email: EMAIL } })
    userId = user.id
    const other = await prisma.user.create({ data: { email: OTHER_EMAIL } })

    const { buildApp } = await import('./app')
    app = await buildApp()
    token = app.jwt.sign({ sub: userId })
    otherToken = app.jwt.sign({ sub: other.id })
  })

  afterAll(async () => {
    await app.close()
  })

  it('enregistre un token — persisté avec le bon userId', async () => {
    const { prisma } = await import('@flipsync/db')
    const pushToken = 'ExponentPushToken[device-token-test-1]'

    const res = await app.inject({
      method: 'POST',
      url: '/notifications/device-token',
      headers: authed(token),
      payload: { token: pushToken },
    })
    expect(res.statusCode).toBe(200)

    const row = await prisma.deviceToken.findUnique({ where: { token: pushToken } })
    expect(row?.userId).toBe(userId)
  })

  it('ré-enregistrer le même token sous un autre user le réaffecte (pas de conflit unique)', async () => {
    const { prisma } = await import('@flipsync/db')
    const pushToken = 'ExponentPushToken[device-token-test-2]'

    await app.inject({
      method: 'POST',
      url: '/notifications/device-token',
      headers: authed(token),
      payload: { token: pushToken },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/device-token',
      headers: authed(otherToken),
      payload: { token: pushToken },
    })
    expect(res.statusCode).toBe(200)

    const row = await prisma.deviceToken.findUnique({ where: { token: pushToken } })
    const other = await prisma.user.findUnique({ where: { email: OTHER_EMAIL } })
    expect(row?.userId).toBe(other!.id)
  })

  it('désenregistrement : ne supprime que le token du propriétaire courant', async () => {
    const { prisma } = await import('@flipsync/db')
    const pushToken = 'ExponentPushToken[device-token-test-3]'
    await app.inject({
      method: 'POST',
      url: '/notifications/device-token',
      headers: authed(token),
      payload: { token: pushToken },
    })

    const wrongOwner = await app.inject({
      method: 'POST',
      url: '/notifications/device-token/unregister',
      headers: authed(otherToken),
      payload: { token: pushToken },
    })
    expect(wrongOwner.statusCode).toBe(200)
    expect(await prisma.deviceToken.findUnique({ where: { token: pushToken } })).not.toBeNull()

    const rightOwner = await app.inject({
      method: 'POST',
      url: '/notifications/device-token/unregister',
      headers: authed(token),
      payload: { token: pushToken },
    })
    expect(rightOwner.statusCode).toBe(200)
    expect(await prisma.deviceToken.findUnique({ where: { token: pushToken } })).toBeNull()
  })

  it('body invalide → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/device-token',
      headers: authed(token),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})
