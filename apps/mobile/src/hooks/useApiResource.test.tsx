import { describe, expect, it, vi } from 'vitest'
import { act, create, ReactTestRenderer } from 'react-test-renderer'

/**
 * Tests du cycle de vie useApiResource — fetchers mockés (jamais de réseau).
 * expo-router est mocké : useFocusEffect ≈ effet au montage + refocus manuel
 * via focusCb() (simule le retour sur l'onglet, l'écran restant monté).
 */
let focusCb: (() => void) | undefined

vi.mock('expo-router', async () => {
  const { useEffect } = await vi.importActual<typeof import('react')>('react')
  return {
    useFocusEffect: (cb: () => void) => {
      focusCb = cb
      useEffect(() => {
        cb()
      }, [cb])
    },
  }
})

// Le vrai module api.ts tire zustand + react-native-mmkv (natif) — mock complet.
vi.mock('../services/api', () => {
  class ApiError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
    ) {
      super(code)
      this.name = 'ApiError'
    }
  }
  return { ApiError }
})

import { ApiError } from '../services/api'
import { useApiResource } from './useApiResource'

interface Resource {
  data: string | null
  loading: boolean
  refreshing: boolean
  error: string | null
  retry: () => void
  refresh: () => Promise<void>
}

let current: Resource

function Probe({ fetcher }: { fetcher: () => Promise<string> }) {
  current = useApiResource(fetcher)
  return null
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const mount = async (fetcher: () => Promise<string>): Promise<ReactTestRenderer> => {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(<Probe fetcher={fetcher} />)
  })
  return renderer
}

describe('useApiResource', () => {
  it('premier focus : loading → data', async () => {
    const d = deferred<string>()
    await mount(() => d.promise)

    expect(current.loading).toBe(true)
    expect(current.data).toBeNull()

    await act(async () => {
      d.resolve('annonces')
    })

    expect(current.loading).toBe(false)
    expect(current.data).toBe('annonces')
    expect(current.error).toBeNull()
  })

  it('échec initial : code ApiError exposé, retry() recharge', async () => {
    const fetcher = vi
      .fn<[], Promise<string>>()
      .mockRejectedValueOnce(new ApiError('WALLET_NOT_FOUND', 404))
      .mockResolvedValueOnce('ok')
    await mount(fetcher)

    expect(current.error).toBe('WALLET_NOT_FOUND')
    expect(current.data).toBeNull()

    await act(async () => {
      current.retry()
    })

    expect(current.error).toBeNull()
    expect(current.data).toBe('ok')
  })

  it('rejet non-ApiError → NETWORK_ERROR', async () => {
    await mount(() => Promise.reject(new TypeError('fetch failed')))
    expect(current.error).toBe('NETWORK_ERROR')
  })

  it('refocus : refetch SILENCIEUX — données conservées pendant le fetch', async () => {
    const first = deferred<string>()
    const renderer = await mount(() => first.promise)
    await act(async () => {
      first.resolve('v1')
    })
    expect(current.data).toBe('v1')

    // L'écran reste monté, le fetcher évolue (nouvelle donnée côté serveur).
    const second = deferred<string>()
    await act(async () => {
      renderer.update(<Probe fetcher={() => second.promise} />)
    })

    await act(async () => {
      focusCb?.() // retour sur l'onglet
    })
    expect(current.refreshing).toBe(true)
    expect(current.loading).toBe(false)
    expect(current.data).toBe('v1') // pas de flash de skeleton

    await act(async () => {
      second.resolve('v2')
    })
    expect(current.refreshing).toBe(false)
    expect(current.data).toBe('v2')
  })

  it('échec d’un refetch silencieux : erreur exposée, données périmées conservées', async () => {
    const renderer = await mount(() => Promise.resolve('v1'))
    expect(current.data).toBe('v1')

    await act(async () => {
      renderer.update(<Probe fetcher={() => Promise.reject(new ApiError('TIMEOUT', 0))} />)
    })
    await act(async () => {
      focusCb?.()
    })

    expect(current.error).toBe('TIMEOUT')
    expect(current.data).toBe('v1')
    expect(current.loading).toBe(false)
  })
})
