import { describe, expect, it } from 'vitest'
import { ItemCondition } from '@flipsync/core'
import { VisionService, VisionBackend } from './vision'

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
