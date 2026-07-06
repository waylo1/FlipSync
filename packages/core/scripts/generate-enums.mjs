// Génère src/generated/enums.ts depuis packages/db/prisma/schema.prisma.
// Source de vérité UNIQUE : les enums Prisma. Aucune dépendance externe —
// le schéma est parsé textuellement (blocs `enum X { ... }`).
// Lancé automatiquement avant chaque build/typecheck de @flipsync/core
// et après chaque `prisma generate` (cf. packages/db/package.json).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCHEMA = resolve(here, '../../db/prisma/schema.prisma')
const OUT = resolve(here, '../src/generated/enums.ts')

const schema = readFileSync(SCHEMA, 'utf8')

const enums = []
for (const match of schema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const [, name, body] = match
  const values = body
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, '').trim()) // commentaires de fin de ligne
    .filter(Boolean)
  if (values.length === 0) throw new Error(`enum ${name} vide dans schema.prisma`)
  enums.push({ name, values })
}
if (enums.length === 0) throw new Error(`aucun enum trouvé dans ${SCHEMA}`)

const pad = values => Math.max(...values.map(v => v.length))
const blocks = enums.map(({ name, values }) => {
  const width = pad(values)
  const members = values.map(v => `  ${v.padEnd(width)} = '${v}',`).join('\n')
  return `export enum ${name} {\n${members}\n}`
})

const header = `// ─────────────────────────────────────────────────────────────────────────────
// FICHIER GÉNÉRÉ — NE PAS ÉDITER À LA MAIN.
// Source : packages/db/prisma/schema.prisma (enums Prisma = source de vérité).
// Régénération : node packages/core/scripts/generate-enums.mjs
// (automatique au build de @flipsync/core et après prisma generate).
// ─────────────────────────────────────────────────────────────────────────────
`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${header}\n${blocks.join('\n\n')}\n`, 'utf8')
console.log(`[generate-enums] ${enums.map(e => e.name).join(', ')} → ${OUT}`)
