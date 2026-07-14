import { beforeAll, describe, expect, it } from 'vitest'
import { isSignedPhotoUrlValid, signPhotoPath } from './services/photo-url.service'

/** Signature HMAC des URLs photos (Run 6) — pur, sans DB ni réseau. */
describe('photo-url — URLs signées temporaires', () => {
  const PATH = '/uploads/listings/lst_1/abcd.jpg'

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    delete process.env.PHOTO_URL_SECRET
    delete process.env.PHOTO_URL_TTL_SECONDS
  })

  it('signe le chemin : ?exp=<epoch>&sig=<hmac hex>, et se vérifie', () => {
    const signed = signPhotoPath(PATH)
    expect(signed).toMatch(/^\/uploads\/listings\/lst_1\/abcd\.jpg\?exp=\d+&sig=[0-9a-f]{64}$/)
    expect(isSignedPhotoUrlValid(signed)).toBe(true)
  })

  it('rejette : chemin altéré, signature altérée, sans query', () => {
    const signed = signPhotoPath(PATH)
    expect(isSignedPhotoUrlValid(signed.replace('abcd', 'autre'))).toBe(false)
    expect(isSignedPhotoUrlValid(signed.replace(/sig=.{6}/, 'sig=000000'))).toBe(false)
    expect(isSignedPhotoUrlValid(PATH)).toBe(false)
  })

  it('rejette une signature expirée (TTL négatif) — URLs bien temporaires', () => {
    expect(isSignedPhotoUrlValid(signPhotoPath(PATH, -1))).toBe(false)
  })

  it('rejette un exp falsifié même avec une signature par ailleurs correcte', () => {
    const signed = signPhotoPath(PATH)
    const bumped = signed.replace(/exp=(\d+)/, (_, n: string) => `exp=${Number(n) + 9999}`)
    expect(isSignedPhotoUrlValid(bumped)).toBe(false)
  })
})
