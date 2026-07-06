// Garde des suites DB : test:db EXIGE une base joignable — contrairement à
// `npm run test` où les suites DB sont skippées (avec warning, cf. vitest.setup).
// Sans dépendance : lit .env racine à la main si la variable n'est pas déjà là.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

if (!process.env.DATABASE_URL) {
  try {
    const env = readFileSync(resolve(root, '.env'), 'utf8')
    const match = env.match(/^DATABASE_URL=(.+)$/m)
    if (match) process.env.DATABASE_URL = match[1].trim()
  } catch {
    // pas de .env — le message ci-dessous guide
  }
}

if (!process.env.DATABASE_URL) {
  console.error(
    '\x1b[31m✖ test:db exige DATABASE_URL.\x1b[0m\n' +
      '  Local : docker start flipsync-pg puis renseigner .env (cf. .env.example).\n' +
      '  CI    : service postgres + env DATABASE_URL (cf. .github/workflows/ci.yml).',
  )
  process.exit(1)
}

console.log('✓ DATABASE_URL présente — suites DB actives (échec bruyant si base injoignable).')
