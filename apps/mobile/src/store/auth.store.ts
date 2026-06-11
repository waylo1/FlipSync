import { create } from 'zustand'
import { MMKV } from 'react-native-mmkv'

// MMKV, jamais AsyncStorage (cf. gotchas.md).
const storage = new MMKV({ id: 'flipsync-auth' })
const JWT_KEY = 'jwt'

interface AuthState {
  /** JWT FlipSync — payload { sub: userId } uniquement. */
  token: string | null
  setToken: (token: string | null) => void
}

/**
 * Session auth persistée (MMKV).
 * TODO(Sprint 3) : écran de login qui alimente setToken ; pour l'instant le
 * token est injecté manuellement en dev (cf. seed API + app.jwt.sign).
 */
export const useAuthStore = create<AuthState>(set => ({
  token: storage.getString(JWT_KEY) ?? null,
  setToken: token => {
    if (token) storage.set(JWT_KEY, token)
    else storage.delete(JWT_KEY)
    set({ token })
  },
}))
