import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { LogOut } from 'lucide-react-native'
import { useAuthStore } from '../src/store/auth.store'
import { dev } from '../src/dev-session/recorder'
import { font, space, theme } from '../src/theme'
import { Avatar } from '../src/ui/Avatar'
import { Button } from '../src/ui/Button'
import { StackHeader } from '../src/ui/StackHeader'

export default function ProfileScreen() {
  const router = useRouter()
  const email = useAuthStore(s => s.email)
  const setToken = useAuthStore(s => s.setToken)

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

  divider: {
    height: 1,
    backgroundColor: theme.border,
    marginHorizontal: space[4],
    marginTop: space[7],
  },
  logout: { marginHorizontal: space[4], marginTop: space[4] },
})
