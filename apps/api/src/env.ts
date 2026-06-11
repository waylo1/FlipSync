import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'

// .env racine du monorepo (dev) — les variables déjà présentes priment.
loadEnv({ path: resolve(__dirname, '../../../.env') })
