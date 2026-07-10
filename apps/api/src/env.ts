import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'
import { z } from 'zod'

// .env racine du monorepo (dev) — les variables déjà présentes priment.
loadEnv({ path: resolve(__dirname, '../../../.env') })

const isProd = process.env.NODE_ENV === 'production'

/** Requis en production, optionnel sinon (fallbacks dev : console email, etc.). */
const prodOnly = <T extends z.ZodTypeAny>(schema: T) => (isProd ? schema : schema.optional())

/**
 * Validation fail-fast au démarrage : une variable critique absente fait
 * crasher le boot avec la liste exacte des manquantes — jamais un crash
 * tardif au premier paiement ou au premier email.
 * (Chargé par index.ts et les outils ; les tests construisent leur propre env.)
 */
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(v => v.startsWith('postgres'), 'URL postgresql:// attendue'),
  JWT_SECRET: z.string().min(32, '32 caractères minimum'),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  // Critiques en production uniquement (fallbacks dev sûrs).
  EMAIL_API_KEY: prodOnly(z.string().min(1)),
  EMAIL_FROM: prodOnly(z.string().min(3)),
  PUBLIC_BASE_URL: prodOnly(z.string().url()),
  DIRECT_URL: prodOnly(z.string().min(1)),

  // Optionnels avec défauts applicatifs.
  API_PORT: z.coerce.number().int().positive().optional(),
  API_HOST: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().optional(),
  MAGIC_LINK_REDIRECT_URL: z.string().optional(),
  /** CSV d'emails autorisés sur /admin — vide = aucun accès (fail-closed). */
  ADMIN_EMAILS: z.string().optional(),

  /**
   * Palier Premium « Commissaire-Priseur IA » (missions de vente automatisées).
   * OFF par défaut, y compris en prod : tant que la négociation réelle n'est pas
   * branchée (canal partenaire), on ne démarre aucune mission réelle ni encaisse
   * de paiement Premium. Cf. COMMISSAIRE_PRISEUR_PLAN.md §1. Activer explicitement
   * avec PREMIUM_MISSION_ENABLED=true (dev/démo via canal simulé).
   */
  PREMIUM_MISSION_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => v === 'true'),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  const details = parsed.error.issues
    .map(i => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n')
  console.error(`[env] Configuration invalide (NODE_ENV=${process.env.NODE_ENV ?? '?'}) :\n${details}`)
  throw new Error('ENV_VALIDATION_FAILED')
}

/** Env validé et typé — préférer cet objet à process.env pour les nouvelles lectures. */
export const env = parsed.data
