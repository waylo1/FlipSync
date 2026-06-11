/**
 * Bootstrap vision — orchestration : fichiers GGUF → chargement modèle → prêt.
 * Appelé au démarrage (app/_layout.tsx) et re-déclenchable depuis l'UI (retry).
 * L'état observable vit dans useModelStore ; l'app reste utilisable pendant
 * le téléchargement (wallet, suivi des annonces).
 */
import { areModelsReady, ensureModelFiles, getModelPaths } from './model-files'
import { initVision } from './vision.service'
import { useModelStore } from '../store/model.store'

let bootstrapping: Promise<void> | null = null

async function run(): Promise<void> {
  const store = useModelStore.getState()
  store.reset()

  try {
    let paths = getModelPaths()

    if (await areModelsReady()) {
      // Fichiers déjà sur disque et complets — pas de réseau.
      store.setStatus('loading')
    } else {
      store.setStatus('downloading')
      paths = await ensureModelFiles(p => useModelStore.getState().setProgress(p))
      store.setStatus('loading')
    }

    await initVision(paths)
    store.setStatus('ready')
  } catch (err) {
    const code = err instanceof Error && err.message ? err.message : 'VISION_BOOTSTRAP_FAILED'
    useModelStore.getState().setError(code)
    throw err
  }
}

/** Idempotent : un seul bootstrap à la fois ; relance possible après échec. */
export function bootstrapVision(): Promise<void> {
  if (!bootstrapping) {
    bootstrapping = run().finally(() => {
      // Échec → autoriser un retry ; succès → laisser mémoïsé (modèle chargé).
      if (useModelStore.getState().status !== 'ready') bootstrapping = null
    })
  }
  return bootstrapping
}
