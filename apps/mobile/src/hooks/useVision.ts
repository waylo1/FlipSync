import { useCallback, useState } from 'react'
import type { ListingDraft } from '@flipsync/core'
import { analyzePhotos } from '../services/vision.service'
import { bootstrapVision } from '../services/vision-bootstrap'
import { useModelStore } from '../store/model.store'

interface AnalysisState {
  analyzing: boolean
  draft: ListingDraft | null
  /** Code SNAKE_CASE (AI_TIMEOUT, AI_INVALID_OUTPUT, …) — à transmettre à failAi côté API. */
  errorCode: string | null
}

/**
 * Hook d'analyse vision on-device (GGUF local via llama.rn).
 *
 * `modelStatus`/`downloadProgress` reflètent le provisioning (useModelStore) :
 * l'écran de capture affiche la progression et désactive le bouton tant que
 * status !== 'ready'. `retryModelSetup` relance le bootstrap après un échec
 * (réseau coupé pendant le téléchargement, etc.).
 */
export function useVision() {
  const modelStatus = useModelStore(s => s.status)
  const downloadProgress = useModelStore(s => s.progress)
  const downloadingFile = useModelStore(s => s.currentFile)
  const modelErrorCode = useModelStore(s => s.errorCode)

  const [state, setState] = useState<AnalysisState>({
    analyzing: false,
    draft: null,
    errorCode: null,
  })

  const analyze = useCallback(async (imagesBase64: readonly string[]) => {
    setState({ analyzing: true, draft: null, errorCode: null })
    try {
      const draft = await analyzePhotos(imagesBase64)
      setState({ analyzing: false, draft, errorCode: null })
      return draft
    } catch (err) {
      const code =
        err instanceof Error && 'code' in err && typeof err.code === 'string'
          ? err.code
          : 'AI_UNKNOWN_ERROR'
      setState({ analyzing: false, draft: null, errorCode: code })
      return null
    }
  }, [])

  const retryModelSetup = useCallback(() => {
    bootstrapVision().catch(() => {
      // L'échec est déjà reflété dans useModelStore (status 'error').
    })
  }, [])

  return {
    ...state,
    analyze,
    ready: modelStatus === 'ready',
    modelStatus,
    downloadProgress,
    downloadingFile,
    modelErrorCode,
    retryModelSetup,
  }
}
