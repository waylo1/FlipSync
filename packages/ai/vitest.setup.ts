import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'

// .env racine du monorepo — les variables déjà présentes (CI) priment.
loadEnv({ path: resolve(process.cwd(), '../../.env') })

if (!process.env.DATABASE_URL) {
  console.warn(
    '\n⚠ DATABASE_URL absente — les suites DB seront SKIPPÉES (ce vert est partiel).\n' +
      '  Local : docker start flipsync-pg (cf. .env racine) ou `npm run test:db` pour un échec explicite.\n',
  )
}
