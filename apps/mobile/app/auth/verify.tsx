import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { ApiError, verifyMagicLink } from '../../src/services/api'
import { useAuthStore } from '../../src/store/auth.store'
import { font, space, theme } from '../../src/theme'
import { Button } from '../../src/ui/Button'

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
        const { token: jwt, email } = await verifyMagicLink(token)
        setToken(jwt, email)
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
        <Text accessibilityRole="header" style={styles.title}>
          Lien invalide
        </Text>
        <Text style={styles.body}>
          {error === 'TOKEN_EXPIRED'
            ? 'Ce lien a expiré. Demandez-en un nouveau.'
            : error === 'TOKEN_ALREADY_USED'
              ? 'Ce lien a déjà été utilisé.'
              : `Connexion impossible (${error}).`}
        </Text>
        <Button label="Retour à la connexion" onPress={() => router.replace('/login')} />
      </View>
    )
  }

  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={theme.goldDark} />
      <Text style={styles.body}>Connexion en cours…</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[5],
    gap: space[4],
    backgroundColor: theme.paper,
  },
  title: { fontSize: font.title, fontWeight: '700', color: theme.ink },
  body: { fontSize: font.body, color: theme.muted, textAlign: 'center' },
})
