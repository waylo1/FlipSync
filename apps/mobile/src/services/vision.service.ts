/**
 * Pipeline vision on-device — llama.rn + Moondream2 Q4 GGUF.
 *
 * Règles (cf. rules.md) :
 *   - Inférence TOUJOURS on-device. Jamais d'appel cloud.
 *   - Timeout 15 s (AI_INFERENCE_TIMEOUT_MS) → l'appelant bascule le listing en AI_FAILED.
 *   - Modèle chargé AU DÉMARRAGE de l'app, pas à la demande (cf. gotchas.md).
 *
 * IMPORTANT — import par sous-chemin dist/vision : le point d'entrée de
 * @flipsync/ai ré-exporte ListingEngine, qui tire @flipsync/db (Prisma).
 * Prisma n'a rien à faire dans un bundle React Native ; dist/vision n'importe
 * que zod + @flipsync/core.
 */
import { Platform } from 'react-native'
import { initLlama, LlamaContext } from 'llama.rn'
import {
  VisionService,
  VisionBackend,
  AI_INFERENCE_TIMEOUT_MS,
} from '@flipsync/ai/dist/vision'
import { VisionBackendError } from '@flipsync/ai/dist/errors'
import type { ListingDraft } from '@flipsync/core'

export interface VisionModelConfig {
  /** Chemin local du GGUF Moondream2 Q4 (téléchargé au premier lancement). */
  modelPath: string
  /** Projecteur multimodal (mmproj) requis par llama.cpp pour la vision. */
  mmprojPath: string
}

/** Backend llama.rn — implémente le contrat VisionBackend de @flipsync/ai. */
class LlamaRnVisionBackend implements VisionBackend {
  constructor(private readonly ctx: LlamaContext) {}

  async generate(prompt: string, imagesBase64: readonly string[]): Promise<string> {
    const result = await this.ctx.completion({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...imagesBase64.map(b64 => ({
              type: 'image_url' as const,
              image_url: { url: `data:image/jpeg;base64,${b64}` },
            })),
          ],
        },
      ],
      n_predict: 512,
      temperature: 0.2, // sortie JSON : on veut de la stabilité, pas de la créativité
    })
    return result.text
  }
}

let context: LlamaContext | null = null
let service: VisionService | null = null

/** expo-file-system fournit des URIs file:// ; llama.rn Android attend un chemin brut. */
const toLlamaPath = (uri: string): string =>
  Platform.OS === 'android' ? uri.replace(/^file:\/\//, '') : uri

/**
 * À appeler UNE FOIS au démarrage de l'app (cf. app/_layout.tsx).
 * Le chargement du GGUF prend plusieurs secondes — jamais à la demande.
 */
export async function initVision(config: VisionModelConfig): Promise<void> {
  if (context) return // déjà initialisé

  context = await initLlama({
    model: toLlamaPath(config.modelPath),
    n_ctx: 2048,
    n_gpu_layers: 99, // GPU si dispo, fallback CPU silencieux
  })

  // Projecteur multimodal — requis pour que Moondream2 voie les images.
  // NOTE device : valider sur appareil réel (pas simulateur, cf. gotchas.md).
  await context.initMultimodal({ path: toLlamaPath(config.mmprojPath), use_gpu: true })

  service = new VisionService(new LlamaRnVisionBackend(context), AI_INFERENCE_TIMEOUT_MS)
}

/** Analyse les photos (base64) → ListingDraft validé (prix en centimes Int). */
export async function analyzePhotos(imagesBase64: readonly string[]): Promise<ListingDraft> {
  if (!service) {
    throw new VisionBackendError('VISION_NOT_INITIALIZED') // initVision() d'abord
  }
  return service.analyze(imagesBase64)
}

/** Libération mémoire (changement de modèle, background prolongé). */
export async function releaseVision(): Promise<void> {
  if (context) {
    await context.release()
    context = null
    service = null
  }
}

export const isVisionReady = (): boolean => service !== null
