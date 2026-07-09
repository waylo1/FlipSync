import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Bell, CircleHelp, LogOut, RefreshCcw } from 'lucide-react-native'
import { useAuthStore } from '../src/store/auth.store'
import { dev } from '../src/dev-session/recorder'
import { font, line, radius, space, theme } from '../src/theme'
import { Avatar } from '../src/ui/Avatar'
import { Button } from '../src/ui/Button'
import { Card } from '../src/ui/Card'
import { StackHeader } from '../src/ui/StackHeader'

/** Ligne de réglage — placeholder tant que la fonctionnalité n'est pas branchée. */
function SettingRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View style={styles.row} accessibilityLabel={`${label} — bientôt disponible`}>
      {icon}
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowSoon}>Bientôt</Text>
    </View>
  )
}

export default function ProfileScreen() {
  const router = useRouter()
  const email = useAuthStore(s => s.email)
  const setToken = useAuthStore(s => s.setToken)

  return (
    <View style={styles.screen}>
      <StackHeader title="Mon profil" />
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {/* Identité du compte. */}
        <View style={styles.identity}>
          <Avatar email={email} size={72} />
          <Text style={styles.email} numberOfLines={1}>
            {email ?? 'Compte connecté'}
          </Text>
        </View>

        {/* Réglages — placeholders honnêtes tant que rien n'est branché. */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Paramètres</Text>
          <SettingRow
            icon={<Bell size={font.lead} color={theme.goldDark} />}
            label="Notifications"
          />
          <SettingRow
            icon={<RefreshCcw size={font.lead} color={theme.goldDark} />}
            label="Recharge automatique"
          />
          <SettingRow
            icon={<CircleHelp size={font.lead} color={theme.goldDark} />}
            label="Aide et contact"
          />
        </Card>

        {/* Déconnexion : purge du JWT (MMKV) → la garde (tabs) renvoie au login. */}
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

  identity: { alignItems: 'center', gap: space[3], marginTop: space[4] },
  email: {
    fontSize: font.lead,
    fontWeight: '600',
    color: theme.ink,
    paddingHorizontal: space[5],
  },

  section: { marginHorizontal: space[4], marginTop: space[5], gap: space[3] },
  sectionTitle: { fontSize: font.lead, fontWeight: '700', color: theme.ink },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: space[6] + space[2],
  },
  rowLabel: {
    flex: 1,
    fontSize: font.small,
    lineHeight: line.small,
    fontWeight: '500',
    color: theme.ink,
  },
  rowSoon: {
    fontSize: font.caption,
    fontWeight: '600',
    color: theme.muted,
    backgroundColor: theme.paper,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    overflow: 'hidden',
  },

  logout: { marginHorizontal: space[4], marginTop: space[6] },
})
