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
    "Analyse les photos de l'objet et réponds UNIQUEMENT avec un objet JSON :",
    '{',
    '  "titre": string (max 120 caractères, optimisé SEO),',
    '  "description": string (vendeuse, honnête),',
    '  "categorieLbc": string, "categorieVinted": string,',
    '  "etat": "neuf" | "tres_bon" | "bon" | "correct",',
    '  "prixPlancher": int (CENTIMES, ex: 1500 = 15,00 €),',
    '  "prixHaut": int (CENTIMES, >= prixPlancher),',
    '  "marque": string | null,',
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
      }),
    })
    if (!res.ok) throw new VisionBackendError(`OLLAMA_HTTP_${res.status}`)

    const json = (await res.json()) as { response?: unknown }
    if (typeof json.response !== 'string') throw new VisionBackendError('OLLAMA_BAD_RESPONSE')
    return json.response
  }
}
