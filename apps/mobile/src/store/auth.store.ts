import { create } from 'zustand'
import { MMKV } from 'react-native-mmkv'

// MMKV, jamais AsyncStorage (cf. gotchas.md).
const storage = new MMKV({ id: 'flipsync-auth' })
const JWT_KEY = 'jwt'
const EMAIL_KEY = 'email'

interface AuthState {
  /** JWT FlipSync — payload { sub: userId } uniquement. */
  token: string | null
  /** Email du compte connecté — affichage profil (le JWT ne le porte pas). */
  email: string | null
  setToken: (token: string | null, email?: string | null) => void
}

/** Session auth persistée (MMKV) — alimentée par login/verify, purgée au logout. */
export const useAuthStore = create<AuthState>(set => ({
  token: storage.getString(JWT_KEY) ?? null,
  email: storage.getString(EMAIL_KEY) ?? null,
  setToken: (token, email = null) => {
    if (token) storage.set(JWT_KEY, token)
    else storage.delete(JWT_KEY)
    if (token && email) storage.set(EMAIL_KEY, email)
    else if (!token) storage.delete(EMAIL_KEY)
    set(state => ({ token, email: token ? (email ?? state.email) : null }))
  },
}))
