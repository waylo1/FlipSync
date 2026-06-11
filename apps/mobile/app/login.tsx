import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { ApiError, requestMagicLink, verifyMagicLink } from '../src/services/api'
import { useAuthStore } from '../src/store/auth.store'

/**
 * Connexion par magic link (sans mot de passe).
 * 1. L'utilisateur saisit son email → un lien lui est envoyé.
 * 2. Il ouvre le lien → l'app atterrit sur /auth/verify (deep link) qui échange
 *    le token contre un JWT.
 *
 * En dev, l'API renvoie le lien (devLink) : un bouton permet de continuer
 * directement sur l'émulateur sans boîte mail.
 */
export default function LoginScreen() {
  const router = useRouter()
  const setToken = useAuthStore(s => s.setToken)

  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [devToken, setDevToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const sendLink = useCallback(async () => {
    if (!emailValid || busy) return
    setBusy(true)
    setError(null)
    try {
      const { devLink } = await requestMagicLink(email)
      setSent(true)
      // Dev : extraire le token du devLink pour le raccourci "continuer".
      if (devLink) {
        const t = new URL(devLink).searchParams.get('token')
        setDevToken(t)
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'NETWORK_ERROR'
      setError(`Envoi impossible (${code}). API lancée ? (npm run dev)`)
    } finally {
      setBusy(false)
    }
  }, [email, emailValid, busy])

  const continueWithDevToken = useCallback(async () => {
    if (!devToken) return
    setBusy(true)
    setError(null)
    try {
      const { token } = await verifyMagicLink(devToken)
      setToken(token)
      router.replace('/(tabs)')
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'NETWORK_ERROR'
      setError(`Vérification impossible (${code}).`)
    } finally {
      setBusy(false)
    }
  }, [devToken, setToken, router])

  if (sent) {
    return (
      <View style={styles.container}>
        <Text style={styles.logo}>FlipSync</Text>
        <Text style={styles.title}>Vérifiez vos emails</Text>
        <Text style={styles.body}>
          Si un compte existe pour {email.trim().toLowerCase()}, un lien de connexion vient d'être
          envoyé. Il est valable 15 minutes.
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        {devToken && (
          <Pressable style={styles.btn} onPress={() => void continueWithDevToken()} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Continuer (dev)</Text>
            )}
          </Pressable>
        )}

        <Pressable
          onPress={() => {
            setSent(false)
            setDevToken(null)
          }}
        >
          <Text style={styles.link}>Utiliser une autre adresse</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>FlipSync</Text>
      <Text style={styles.subtitle}>Connexion par lien magique</Text>

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="email@exemple.fr"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.btn, (!emailValid || busy) && styles.disabled]}
        onPress={() => void sendLink()}
        disabled={!emailValid || busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Recevoir un lien</Text>
        )}
      </Pressable>

      <Text style={styles.hint}>Pas de mot de passe — un lien suffit.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 28, gap: 12, backgroundColor: '#fff' },
  logo: { fontSize: 32, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: 14, opacity: 0.6, textAlign: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 14, opacity: 0.7, textAlign: 'center', lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
  },
  btn: { backgroundColor: '#2563eb', borderRadius: 10, padding: 16, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.4 },
  error: { color: '#dc2626', fontSize: 13 },
  hint: { fontSize: 12, opacity: 0.5, textAlign: 'center' },
  link: { color: '#2563eb', fontWeight: '600', textAlign: 'center', marginTop: 8 },
})
