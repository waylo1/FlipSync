/**
 * Provisioning des modèles GGUF — téléchargement, stockage et intégrité.
 *
 * Les GGUF (~2 GB au total) sont hors bundle (cf. .gitignore *.gguf) :
 * téléchargés au premier lancement dans documentDirectory/models/, puis
 * vérifiés à chaque démarrage via un manifest (taille attendue = taille disque).
 * Un fichier partiel (app tuée en plein download) est détecté et re-téléchargé.
 */
import * as FileSystem from 'expo-file-system'

// ─── Registre des modèles ─────────────────────────────────────────────────────
// NOTE quantisation : pas de Q4 publié pour Moondream2 — Q5_K (1,06 GB) retenu,
// meilleur compromis taille/qualité dispo. Pour un vrai Q4_K_M : llama-quantize
// depuis le f16 puis remplacer url/bytes ici (seule source de vérité).

interface ModelFileSpec {
  readonly key: 'text' | 'mmproj'
  readonly filename: string
  readonly url: string
  /** Taille attendue en octets — contrôle d'intégrité (fichier partiel/corrompu). */
  readonly bytes: number
}

const HF_BASE = 'https://huggingface.co/cjpais/moondream2-llamafile/resolve/main'

export const MODEL_REGISTRY: readonly ModelFileSpec[] = [
  {
    key: 'text',
    filename: 'moondream2-050824-q5k.gguf',
    url: `${HF_BASE}/moondream2-050824-q5k.gguf`,
    bytes: 1_060_000_000, // ~1,06 GB — ajusté au premier download (manifest)
  },
  {
    key: 'mmproj',
    filename: 'moondream2-mmproj-050824-f16.gguf',
    url: `${HF_BASE}/moondream2-mmproj-050824-f16.gguf`,
    bytes: 910_000_000, // ~910 MB
  },
]

const MODELS_DIR = `${FileSystem.documentDirectory}models/`
const MANIFEST_PATH = `${MODELS_DIR}manifest.json`

/** Octets réellement écrits par fichier — la vérité vient du download, pas du registre. */
type Manifest = Record<string, { url: string; bytes: number }>

export interface ModelPaths {
  modelPath: string // GGUF texte
  mmprojPath: string // projecteur multimodal
}

export interface DownloadProgress {
  key: 'text' | 'mmproj'
  fileIndex: number // 0-based
  fileCount: number
  receivedBytes: number
  totalBytes: number
  /** Progression globale 0..1 (tous fichiers confondus). */
  overallRatio: number
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

const readManifest = async (): Promise<Manifest> => {
  try {
    const raw = await FileSystem.readAsStringAsync(MANIFEST_PATH)
    return JSON.parse(raw) as Manifest
  } catch {
    return {}
  }
}

const writeManifest = async (manifest: Manifest): Promise<void> => {
  await FileSystem.writeAsStringAsync(MANIFEST_PATH, JSON.stringify(manifest))
}

const fileIsComplete = async (spec: ModelFileSpec, manifest: Manifest): Promise<boolean> => {
  const entry = manifest[spec.filename]
  if (!entry || entry.url !== spec.url) return false // URL changée → re-télécharger

  const info = await FileSystem.getInfoAsync(`${MODELS_DIR}${spec.filename}`)
  return info.exists && !info.isDirectory && info.size === entry.bytes
}

// ─── API publique ─────────────────────────────────────────────────────────────

export const getModelPaths = (): ModelPaths => ({
  modelPath: `${MODELS_DIR}${MODEL_REGISTRY[0]?.filename ?? ''}`,
  mmprojPath: `${MODELS_DIR}${MODEL_REGISTRY[1]?.filename ?? ''}`,
})

/** true si tous les fichiers sont présents et complets (aucun réseau requis). */
export const areModelsReady = async (): Promise<boolean> => {
  const manifest = await readManifest()
  for (const spec of MODEL_REGISTRY) {
    if (!(await fileIsComplete(spec, manifest))) return false
  }
  return true
}

/**
 * Garantit la présence des modèles : télécharge ce qui manque, vérifie le reste.
 * Idempotent — appel sûr à chaque démarrage. Jette en cas d'échec réseau,
 * l'appelant décide (retry UI) ; un fichier partiel sera repris/écrasé au retry.
 */
export async function ensureModelFiles(
  onProgress?: (p: DownloadProgress) => void,
): Promise<ModelPaths> {
  await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true })
  const manifest = await readManifest()
  const fileCount = MODEL_REGISTRY.length

  for (const [fileIndex, spec] of MODEL_REGISTRY.entries()) {
    if (await fileIsComplete(spec, manifest)) continue

    const target = `${MODELS_DIR}${spec.filename}`
    // Reste d'un download interrompu → reparti de zéro (pas de resumeData persisté).
    const stale = await FileSystem.getInfoAsync(target)
    if (stale.exists) await FileSystem.deleteAsync(target, { idempotent: true })

    const download = FileSystem.createDownloadResumable(spec.url, target, {}, data => {
      const totalBytes = data.totalBytesExpectedToWrite || spec.bytes
      onProgress?.({
        key: spec.key,
        fileIndex,
        fileCount,
        receivedBytes: data.totalBytesWritten,
        totalBytes,
        overallRatio: (fileIndex + data.totalBytesWritten / totalBytes) / fileCount,
      })
    })

    const result = await download.downloadAsync()
    if (!result || result.status !== 200) {
      throw new Error(`MODEL_DOWNLOAD_FAILED_${spec.key.toUpperCase()}`)
    }

    const info = await FileSystem.getInfoAsync(target)
    if (!info.exists || info.isDirectory || info.size === 0) {
      throw new Error(`MODEL_FILE_INCOMPLETE_${spec.key.toUpperCase()}`)
    }

    manifest[spec.filename] = { url: spec.url, bytes: info.size }
    await writeManifest(manifest)
  }

  return getModelPaths()
}

/** Purge complète (re-téléchargement forcé, libération stockage). */
export async function deleteModelFiles(): Promise<void> {
  await FileSystem.deleteAsync(MODELS_DIR, { idempotent: true })
}
