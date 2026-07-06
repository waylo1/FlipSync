import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { ApiError } from '../services/api'

interface ApiResource<T> {
  /** null tant que le premier chargement n'a pas abouti. */
  data: T | null
  /** Premier chargement (ou retry après erreur) — afficher les skeletons. */
  loading: boolean
  /** Pull-to-refresh en cours (les données restent affichées). */
  refreshing: boolean
  /** Code erreur SNAKE_CASE du dernier échec, null sinon. */
  error: string | null
  /** Relance complète (retry) — repasse par loading. */
  retry: () => void
  /** Rafraîchissement silencieux (RefreshControl). */
  refresh: () => Promise<void>
}

/**
 * Ressource API liée au focus de l'écran :
 * — premier focus → chargement (skeleton) ;
 * — retours d'écran → refetch silencieux (une annonce validée apparaît sans relancer) ;
 * — erreurs normalisées en codes SNAKE_CASE (ApiError).
 * Zéro cache global, zéro dépendance — le serveur reste la source de vérité.
 */
export function useApiResource<T>(fetcher: () => Promise<T>): ApiResource<T> {
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasLoaded = useRef(false)
  const inFlight = useRef(false)

  const load = useCallback(async (silent: boolean) => {
    if (inFlight.current) return
    inFlight.current = true
    if (silent) setRefreshing(true)
    else {
      setLoading(true)
      setError(null)
    }
    try {
      const result = await fetcherRef.current()
      setData(result)
      setError(null)
      hasLoaded.current = true
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'NETWORK_ERROR'
      // En refetch silencieux, on garde les données affichées ; l'erreur est montrée.
      setError(code)
    } finally {
      inFlight.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load(hasLoaded.current)
    }, [load]),
  )

  return {
    data,
    loading,
    refreshing,
    error,
    retry: () => void load(false),
    refresh: () => load(true),
  }
}
