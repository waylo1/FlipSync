import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { ApiError, verifyMagicLink } from '../../src/services/api'
import { useAuthStore } from '../../src/store/auth.store'

/**
 * Cible du deep link magic link : flipsync://auth/verify?token=...
 * Échange le token contre un JWT, le stocke (MMKV) et redirige vers l'app.
 */
export default function VerifyScreen() {
  const router = useRouter()
  const { token } = useLocalSearchParams<{ token?: string }>()
  const setToken = useAuthStore(s => s.setToken)

  const [error, setError] = useState<string | null>(null)
  const done = useRef(false)

  useEffect(() => {
    if (done.current || !token) return
    done.current = true
    ;(async () => {
      try {
        const { token: jwt } = await verifyMagicLink(token)
        setToken(jwt)
        router.replace('/(tabs)')
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'NETWORK_ERROR')
      }
    })()
  }, [token, setToken, router])

  // Lien ouvert sans token (cas anormal) → retour login.
  if (!token) return <Redirect href="/login" />

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Lien invalide</Text>
        <Text style={styles.body}>
          {error === 'TOKEN_EXPIRED'
            ? 'Ce lien a expiré. Demandez-en un nouveau.'
            : error === 'TOKEN_ALREADY_USED'
              ? 'Ce lien a déjà été utilisé.'
              : `Connexion impossible (${error}).`}
        </Text>
        <Pressable style={styles.btn} onPress={() => router.replace('/login')}>
          <Text style={styles.btnText}>Retour à la connexion</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#2563eb" />
      <Text style={styles.body}>Connexion en cours…</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 14, opacity: 0.7, textAlign: 'center' },
  btn: { backgroundColor: '#2563eb', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 14 },
  btnText: { color: '#fff', fontWeight: '700' },
})
