import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ApiError, requestMagicLink, verifyMagicLink } from '../src/services/api'
import { useAuthStore } from '../src/store/auth.store'
import { dev } from '../src/dev-session/recorder'
import { font, line, space, theme } from '../src/theme'
import { Button } from '../src/ui/Button'
import { Field } from '../src/ui/Field'
import { ErrorBanner } from '../src/ui/ErrorBanner'

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
    dev.track('login_started')
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
      const { token, email: verifiedEmail } = await verifyMagicLink(devToken)
      setToken(token, verifiedEmail)
      dev.track('login_success')
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
        <Text accessibilityRole="header" style={styles.title}>
          Vérifiez vos emails
        </Text>
        <Text style={styles.body}>
          Si un compte existe pour {email.trim().toLowerCase()}, un lien de connexion vient d'être
          envoyé. Il est valable 15 minutes.
        </Text>

        {error && <ErrorBanner message={error} />}

        {devToken && (
          <Button
            label="Continuer (dev)"
            onPress={() => void continueWithDevToken()}
            loading={busy}
          />
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Utiliser une autre adresse email"
          hitSlop={space[2]}
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
      <Text style={styles.subtitle}>Vos objets ont une seconde vie</Text>

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="email@exemple.fr"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
        autoFocus
        returnKeyType="send"
        onSubmitEditing={() => void sendLink()}
      />

      {error && <ErrorBanner message={error} />}

      <Button
        label="Recevoir un lien de connexion"
        onPress={() => void sendLink()}
        loading={busy}
        disabled={!emailValid}
      />

      <Text style={styles.hint}>Pas de mot de passe — un lien par email suffit.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: space[5],
    gap: space[3],
    backgroundColor: theme.paper,
  },
  logo: { fontSize: font.display, fontWeight: '800', textAlign: 'center', color: theme.ink },
  subtitle: {
    fontSize: font.body,
    color: theme.muted,
    textAlign: 'center',
    marginBottom: space[4],
  },
  title: {
    fontSize: font.title,
    lineHeight: line.title,
    fontWeight: '700',
    textAlign: 'center',
    color: theme.ink,
  },
  body: {
    fontSize: font.body,
    color: theme.muted,
    textAlign: 'center',
    lineHeight: space[5] - space[1],
  },
  hint: { fontSize: font.caption, color: theme.muted, textAlign: 'center' },
  link: {
    color: theme.terracotta,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: space[2],
    fontSize: font.body,
  },
})
