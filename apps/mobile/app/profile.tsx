import { useEffect } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { LogOut } from 'lucide-react-native'
import { useAuthStore } from '../src/store/auth.store'
import { dev, trackEvent } from '../src/dev-session/recorder'
import { api } from '../src/services/api'
import { useApiResource } from '../src/hooks/useApiResource'
import { MarketplaceStatus } from '../src/components/MarketplaceStatus'
import { font, space, theme } from '../src/theme'
import { Avatar } from '../src/ui/Avatar'
import { Button } from '../src/ui/Button'
import { ErrorBanner } from '../src/ui/ErrorBanner'
import { Skeleton } from '../src/ui/Skeleton'
import { StackHeader } from '../src/ui/StackHeader'

export default function ProfileScreen() {
  const router = useRouter()
  const email = useAuthStore(s => s.email)
  const setToken = useAuthStore(s => s.setToken)
  const platforms = useApiResource(api.getMarketplaceStatus)

  // Trace Developer Session : états réellement affichés (diagnostic publication).
  useEffect(() => {
    if (!platforms.data) return
    trackEvent(
      'marketplace_status',
      Object.fromEntries(platforms.data.connections.map(c => [c.marketplace, c.state])),
    )
  }, [platforms.data])

  return (
    <View style={styles.screen}>
      <StackHeader title="Mon profil" />
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {/* Identité du compte — seule information réelle à mettre en avant ici. */}
        <View style={styles.identity}>
          <Avatar email={email} size={72} />
          <Text style={styles.email} numberOfLines={1}>
            {email ?? 'Compte connecté'}
          </Text>
          <Text style={styles.version}>Version {Constants.expoConfig?.version ?? '—'}</Text>
        </View>

        {/* Connexions marketplace — état RÉEL renvoyé par l'API, jamais supposé. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Plateformes</Text>
          {platforms.error !== null && (
            <ErrorBanner message="Impossible de vérifier les connexions." onRetry={platforms.retry} />
          )}
          {platforms.loading && platforms.error === null && <Skeleton height={space[8]} round="lg" />}
          {platforms.data !== null && !platforms.loading && (
            <MarketplaceStatus connections={platforms.data.connections} />
          )}
        </View>

        {/* Séparée du reste : seule action de l'écran, jamais confondue avec un réglage. */}
        <View style={styles.divider} />
        <Button
          label="Se déconnecter"
          variant="ghost"
          icon={<LogOut size={font.lead} color={theme.ink} />}
          onPress={() => {
            dev.track('logout')
            setToken(null)
            router.replace('/login')
          }}
          style={styles.logout}
        />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  content: { flex: 1 },
  contentInner: { paddingBottom: space[7] },

  identity: { alignItems: 'center', gap: space[2], marginTop: space[6] },
  email: {
    fontSize: font.lead,
    fontWeight: '600',
    color: theme.ink,
    paddingHorizontal: space[5],
  },
  version: { fontSize: font.caption, color: theme.muted },

  section: { marginHorizontal: space[4], marginTop: space[6], gap: space[3] },
  sectionTitle: { fontSize: font.lead, fontWeight: '700', color: theme.ink },

  divider: {
    height: 1,
    backgroundColor: theme.border,
    marginHorizontal: space[4],
    marginTop: space[7],
  },
  logout: { marginHorizontal: space[4], marginTop: space[4] },
})
