/**
 * test-pipeline — valide le pipeline IA + publication SANS device mobile.
 *
 * Simule le flux mobile complet contre l'API réelle (fastify.inject, routes
 * et JWT réels, DB Postgres locale) :
 *   1. charge une image de test depuis tools/fixtures/
 *   2. POST /listing (authorize wallet) + POST /listing/:id/photos (sha256)
 *   3. injecte un brouillon IA MOCKÉ via POST /listing/:id/draft
 *      (à la place de l'inférence Moondream2 on-device)
 *   4. POST /listing/:id/validate (commit wallet) puis /publish
 *      → MockMarketplacePublisher écrit debug/publish_log.json
 *   5. vérifie le contenu du log et affiche SUCCESS / FAILURE.
 *
 * Lancement : npm run pipeline:mock -w @flipsync/api
 * Prérequis : Postgres local (conteneur flipsync-pg) démarré.
 */
import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Mode mock AVANT tout import de l'app (lu par le plugin services).
process.env.MARKETPLACE_MOCK = '1'
const LOG_PATH = resolve(process.env.MOCK_PUBLISH_LOG ?? join(process.cwd(), 'debug', 'publish_log.json'))
process.env.MOCK_PUBLISH_LOG = LOG_PATH

import '../src/env'
import { buildApp } from '../src/app'
import type { MockPublishLogEntry } from '@flipsync/marketplace'

const FIXTURE = resolve(__dirname, 'fixtures', 'test-image.jpg')

/** Brouillon "IA" injecté à la place de Moondream2 — mêmes règles que le modèle. */
const MOCK_AI_DRAFT = {
  titre: 'Veste en cuir Schott vintage',
  description: 'Veste en cuir véritable, très bon état, peu portée. Taille M.',
  categorieId: 'vetements-homme-veste',
  etat: 'tres_bon',
  prixPlancher: 8000, // centimes
  prixHaut: 12000,
  marque: 'Schott',
  confidence: 0.92,
}
const PRIX_PUBLIE = 9900 // centimes — dans [plancher, haut*1.2], pas de flag

function fail(step: string, detail: unknown): never {
  console.error(`FAILURE @ ${step}:`, detail)
  process.exit(1)
}

async function main(): Promise<void> {
  // 1. Image de test depuis fixtures/ — même convention que le mobile :
  //    sha256 de la CHAÎNE base64.
  const base64 = (await readFile(FIXTURE)).toString('base64')
  const sha256 = createHash('sha256').update(base64).digest('hex')
  console.log(`[1/7] fixture chargée: ${FIXTURE} (${base64.length} chars base64)`)

  await rm(LOG_PATH, { force: true }) // run reproductible

  const app = await buildApp()
  const post = async (url: string, payload?: unknown, token?: string) => {
    const res = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    })
    return { status: res.statusCode, json: res.json() as Record<string, unknown> }
  }

  try {
    // 2. Auth dev (user frais → 3 listings gratuits, aucun débit à provisionner).
    const email = `pipeline-${Date.now()}@flipsync.test`
    const auth = await post('/auth/dev-token', { email })
    if (auth.status !== 200) fail('auth/dev-token', auth)
    const token = auth.json.token as string
    console.log(`[2/7] JWT obtenu (${email})`)

    // 3. Création listing (authorize wallet, 0 débit).
    const created = await post('/listing', { tier: 'SIMPLE' }, token)
    const listing = created.json.listing as { id: string; status: string } | undefined
    if (created.status !== 201 || listing?.status !== 'AUTHORIZED') fail('POST /listing', created)
    const id = listing.id
    console.log(`[3/7] listing ${id} AUTHORIZED`)

    // 4. Upload photo — intégrité sha256 vérifiée serveur.
    const photos = await post(`/listing/${id}/photos`, { photos: [{ base64, sha256, order: 0 }] }, token)
    if (photos.status !== 201) fail('POST /photos', photos)
    console.log(`[4/7] photo uploadée (sha256=${sha256.slice(0, 12)}…)`)

    // 5. Pipeline IA : ai-start puis draft MOCKÉ (remplace Moondream2).
    const aiStart = await post(`/listing/${id}/ai-start`, undefined, token)
    if (aiStart.status !== 200) fail('POST /ai-start', aiStart)
    const draft = await post(`/listing/${id}/draft`, MOCK_AI_DRAFT, token)
    const drafted = draft.json.listing as { status: string } | undefined
    if (draft.status !== 200 || drafted?.status !== 'DRAFT_READY') fail('POST /draft', draft)
    console.log('[5/7] brouillon IA mocké injecté → DRAFT_READY')

    // 6. Validation user (commit wallet) → QUEUED, puis publication mockée.
    const validated = await post(`/listing/${id}/validate`, { prixPublie: PRIX_PUBLIE }, token)
    const queued = validated.json.listing as { status: string } | undefined
    if (validated.status !== 200 || queued?.status !== 'QUEUED') fail('POST /validate', validated)
    const published = await post(`/listing/${id}/publish`, { marketplace: 'VINTED' }, token)
    if (published.status !== 200 || published.json.status !== 'PUBLISHED') {
      fail('POST /publish', published)
    }
    // Réponse multi-canal (PublicationOutcome) : l'URL vit dans results[], par plateforme.
    const results = published.json.results as Array<{ marketplace: string; ok: boolean; url?: string | null }>
    const vintedResult = results?.find(r => r.marketplace === 'VINTED')
    if (!vintedResult?.ok) fail('POST /publish (résultat VINTED)', published)
    console.log(`[6/7] publié (mock) → ${vintedResult.url}`)

    // 7. Vérification du log JSON écrit par MockMarketplacePublisher.
    const raw = await readFile(LOG_PATH, 'utf8')
    const log = JSON.parse(raw) as MockPublishLogEntry[]
    const entry = log[log.length - 1]
    const checks: Array<[string, boolean]> = [
      ['une entrée écrite', log.length === 1],
      ['marketplace VINTED', entry?.marketplace === 'VINTED'],
      ['titre du draft mocké', entry?.payload.titre === MOCK_AI_DRAFT.titre],
      ['catégorie canonique', entry?.payload.categorie === MOCK_AI_DRAFT.categorieId],
      ['prix publié en centimes Int', entry?.payload.mode === 'fixed' && entry.payload.prix === PRIX_PUBLIE],
      ['photo (sha256) dans le payload', entry?.payload.photos.some(p => p.url.includes(sha256)) === true],
      ['url mock retournée', entry?.url === vintedResult.url],
    ]
    const failed = checks.filter(([, ok]) => !ok)

    console.log(`[7/7] contenu de ${LOG_PATH} :`)
    console.log(raw)

    if (failed.length > 0) fail('vérification log', failed.map(([label]) => label))
    console.log('SUCCESS')
  } finally {
    await app.close()
  }
}

main().catch(err => fail('unexpected', err))
