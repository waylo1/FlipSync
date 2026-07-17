import { describe, expect, it, vi } from 'vitest'
import { ItemCondition } from '@flipsync/core'
import {
  AnthropicVisionBackend,
  OllamaVisionBackend,
  VisionBackend,
  VisionService,
  createVisionBackend,
} from './vision'

const validDraft = {
  titre: 'Veste en cuir Schott NYC',
  description: 'Veste en cuir véritable, très bon état, peu portée.',
  categorieId: 'vetements-homme-veste',
  etat: 'tres_bon',
  prixPlancher: 8000,
  prixHaut: 12000,
  marque: 'Schott',
  confidence: 0.87,
}

const backendReturning = (raw: string): VisionBackend => ({
  generate: async () => raw,
})

const IMAGES = ['ZmFrZS1pbWFnZQ=='] // base64 factice

describe('VisionService.analyze', () => {
  it('parse un JSON valide en ListingDraft (prix en centimes Int)', async () => {
    const svc = new VisionService(backendReturning(JSON.stringify(validDraft)))
    const draft = await svc.analyze(IMAGES)

    expect(draft.titre).toBe('Veste en cuir Schott NYC')
    expect(draft.etat).toBe(ItemCondition.tres_bon)
    expect(draft.prixPlancher).toBe(8000)
    expect(draft.prixHaut).toBe(12000)
    expect(draft.confidence).toBeCloseTo(0.87)
  })

  it('tolère les fences markdown autour du JSON', async () => {
    const svc = new VisionService(
      backendReturning('```json\n' + JSON.stringify(validDraft) + '\n```'),
    )
    await expect(svc.analyze(IMAGES)).resolves.toMatchObject({ marque: 'Schott' })
  })

  it('rejette un JSON non parsable → AI_INVALID_OUTPUT', async () => {
    const svc = new VisionService(backendReturning('pas du json'))
    await expect(svc.analyze(IMAGES)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
  })

  it('rejette des prix Float — centimes Int obligatoires', async () => {
    const svc = new VisionService(
      backendReturning(JSON.stringify({ ...validDraft, prixPlancher: 80.5 })),
    )
    await expect(svc.analyze(IMAGES)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
  })

  it('rejette prixPlancher > prixHaut', async () => {
    const svc = new VisionService(
      backendReturning(JSON.stringify({ ...validDraft, prixPlancher: 15000 })),
    )
    await expect(svc.analyze(IMAGES)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
  })

  it('rejette un état hors enum ItemCondition', async () => {
    const svc = new VisionService(
      backendReturning(JSON.stringify({ ...validDraft, etat: 'comme_neuf' })),
    )
    await expect(svc.analyze(IMAGES)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
  })

  it('rejette confidence hors [0,1]', async () => {
    const svc = new VisionService(
      backendReturning(JSON.stringify({ ...validDraft, confidence: 1.4 })),
    )
    await expect(svc.analyze(IMAGES)).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
  })

  it('timeout → AI_TIMEOUT (le listing devra basculer en AI_FAILED)', async () => {
    const never: VisionBackend = { generate: () => new Promise<string>(() => undefined) }
    const svc = new VisionService(never, 20) // 20 ms pour le test
    await expect(svc.analyze(IMAGES)).rejects.toMatchObject({ code: 'AI_TIMEOUT' })
  })

  it('exige au moins une image', async () => {
    const svc = new VisionService(backendReturning(JSON.stringify(validDraft)))
    await expect(svc.analyze([])).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' })
  })
})

describe('createVisionBackend', () => {
  it('sans clé, hors prod → Ollama (modèle local du PC de dev)', () => {
    expect(createVisionBackend({ NODE_ENV: 'development' })).toBeInstanceOf(OllamaVisionBackend)
  })

  it('avec une clé → Anthropic, sans avoir à le demander', () => {
    expect(createVisionBackend({ ANTHROPIC_API_KEY: 'sk-ant-xxx' })).toBeInstanceOf(
      AnthropicVisionBackend,
    )
  })

  it('en production sans clé → refuse de démarrer plutôt que de tomber sur Ollama', () => {
    // Ollama n'existe pas dans l'image Docker : le sélectionner en prod ferait
    // échouer CHAQUE annonce (AI_FAILED + remboursement) au lieu de crasher au boot.
    expect(() => createVisionBackend({ NODE_ENV: 'production' })).toThrowError(
      /OLLAMA_BACKEND_FORBIDDEN_IN_PRODUCTION/,
    )
  })

  it('backend anthropic demandé explicitement sans clé → erreur explicite', () => {
    expect(() => createVisionBackend({ AI_VISION_BACKEND: 'anthropic' })).toThrowError(
      /ANTHROPIC_API_KEY_MISSING/,
    )
  })

  it('AI_VISION_BACKEND=ollama force Ollama même si une clé traîne (dev)', () => {
    expect(
      createVisionBackend({ AI_VISION_BACKEND: 'ollama', ANTHROPIC_API_KEY: 'sk-ant-xxx' }),
    ).toBeInstanceOf(OllamaVisionBackend)
  })
})

describe('AnthropicVisionBackend.generate', () => {
  const okResponse = (text: string) =>
    vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text }] })))

  it('renvoie le texte du bloc de réponse et envoie les images en base64', async () => {
    const fetchMock = okResponse('{"titre":"ok"}')
    vi.stubGlobal('fetch', fetchMock)

    const raw = await new AnthropicVisionBackend('sk-ant-xxx').generate('prompt', ['/9j/abc'])
    expect(raw).toBe('{"titre":"ok"}')

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/abc' },
    })
    vi.unstubAllGlobals()
  })

  it('déduit le media_type du base64 (PNG) — l\'API Anthropic le refuse sinon', async () => {
    const fetchMock = okResponse('{}')
    vi.stubGlobal('fetch', fetchMock)

    await new AnthropicVisionBackend('sk-ant-xxx').generate('prompt', ['iVBORw0KGgo'])
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.messages[0].content[0].source.media_type).toBe('image/png')
    vi.unstubAllGlobals()
  })

  it('HTTP non-2xx → AI_BACKEND_ERROR avec le code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))

    await expect(
      new AnthropicVisionBackend('sk-ant-bad').generate('prompt', ['/9j/abc']),
    ).rejects.toMatchObject({ message: expect.stringContaining('ANTHROPIC_HTTP_401') })
    vi.unstubAllGlobals()
  })
})
