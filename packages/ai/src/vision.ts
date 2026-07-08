import { z } from 'zod'
import { ItemCondition, ListingDraft } from '@flipsync/core'
import { VisionBackendError, VisionParseError, VisionTimeoutError } from './errors'

/**
 * Inférence IA — TOUJOURS on-device en production (llama.rn + Moondream2 Q4 GGUF).
 * Jamais d'appel cloud pour l'analyse vision (cf. rules.md).
 * Timeout modèle : 15 s max, sinon le listing bascule en AI_FAILED.
 */
export const AI_INFERENCE_TIMEOUT_MS = 15_000

/**
 * Backend d'inférence interchangeable :
 *   - Production mobile : LlamaRnBackend (llama.rn, vit dans apps/mobile — runtime RN requis).
 *   - Dev local API     : OllamaVisionBackend ci-dessous (localhost uniquement, jamais cloud).
 */
export interface VisionBackend {
  /** Retourne la sortie brute du modèle (attendue : JSON ListingDraft). */
  generate(prompt: string, imagesBase64: readonly string[]): Promise<string>
}

// ─── Validation de la sortie modèle ───────────────────────────────────────────

/** Prix en centimes Int — la sortie modèle est validée comme tout input externe. */
const draftSchema = z
  .object({
    titre: z.string().min(1).max(120),
    description: z.string().min(1),
    categorieLbc: z.string().min(1),
    categorieVinted: z.string().min(1),
    etat: z.nativeEnum(ItemCondition),
    prixPlancher: z.number().int().nonnegative(),
    prixHaut: z.number().int().nonnegative(),
    marque: z.string().min(1).nullable(),
    confidence: z.number().min(0).max(1),
  })
  .refine(d => d.prixPlancher <= d.prixHaut, {
    message: 'prixPlancher doit être <= prixHaut',
  })

/** Le modèle peut entourer le JSON de fences markdown — on les retire. */
const stripCodeFences = (raw: string): string =>
  raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

const buildPrompt = (): string =>
  [
    'Tu es un expert de la revente sur Leboncoin et Vinted.',
    "Analyse les photos de l'objet à vendre (plusieurs angles du MÊME objet).",
    'Réponds UNIQUEMENT avec un objet JSON, sans texte autour.',
    'Toutes les valeurs texte sont en FRANÇAIS.',
    '{',
    '  "titre": string (max 120 caractères, optimisé recherche),',
    '  "description": string (vendeuse, honnête, 2-4 phrases en français),',
    '  "categorieLbc": string, "categorieVinted": string,',
    '  "etat": "neuf" | "tres_bon" | "bon" | "correct",',
    '  "prixPlancher": int — prix bas RÉALISTE du marché de l\'occasion en France,',
    '    en CENTIMES d\'euro (euros × 100 : un objet à 15 € → 1500),',
    '  "prixHaut": int (CENTIMES, >= prixPlancher),',
    '  "marque": string | null (null si aucune marque identifiable),',
    '  "confidence": float entre 0 et 1',
    '}',
  ].join('\n')

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * VisionService — pipeline d'analyse : photos → modèle → ListingDraft validé.
 * Toute erreur (timeout, JSON invalide, backend) doit conduire l'appelant
 * (ListingEngine) à failAi(listingId, error.code).
 */
export class VisionService {
  constructor(
    private readonly backend: VisionBackend,
    private readonly timeoutMs: number = AI_INFERENCE_TIMEOUT_MS,
  ) {}

  async analyze(imagesBase64: readonly string[]): Promise<ListingDraft> {
    if (imagesBase64.length === 0) throw new VisionParseError('aucune image fournie')

    const raw = await this.withTimeout(this.backend.generate(buildPrompt(), imagesBase64))

    let parsed: unknown
    try {
      parsed = JSON.parse(stripCodeFences(raw))
    } catch {
      throw new VisionParseError('JSON non parsable')
    }

    const result = draftSchema.safeParse(parsed)
    if (!result.success) {
      throw new VisionParseError(result.error.issues.map(i => i.message).join('; '))
    }
    return result.data
  }

  private async withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new VisionTimeoutError(this.timeoutMs)), this.timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}

// ─── Backend dev local (Ollama) ───────────────────────────────────────────────

/**
 * DEV UNIQUEMENT — Ollama sur localhost (cf. env.md). N'est PAS un appel cloud :
 * le modèle tourne sur la machine du développeur. En production mobile,
 * le backend llama.rn vit dans apps/mobile (nécessite le runtime React Native).
 */
export class OllamaVisionBackend implements VisionBackend {
  constructor(
    private readonly baseUrl: string = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    private readonly model: string = process.env.OLLAMA_MODEL ?? 'moondream2',
  ) {}

  async generate(prompt: string, imagesBase64: readonly string[]): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        images: imagesBase64,
        stream: false,
        format: 'json',
        options: {
          // 8 photos × ~700-1300 tokens d'encodage vision + prompt + réponse :
          // le num_ctx par défaut (4096) déborde dès 3-4 photos.
          num_ctx: 16384,
          // Sortie JSON : stabilité avant créativité ; plafond large (le JSON
          // complet fait ~200-300 tokens, on coupe les délires du modèle).
          temperature: 0.2,
          num_predict: 700,
        },
      }),
    })
    if (!res.ok) throw new VisionBackendError(`OLLAMA_HTTP_${res.status}`)

    const json = (await res.json()) as { response?: unknown }
    if (typeof json.response !== 'string') throw new VisionBackendError('OLLAMA_BAD_RESPONSE')
    return json.response
  }
}
