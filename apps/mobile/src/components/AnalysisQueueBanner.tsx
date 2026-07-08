import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronRight, Loader, Sparkles } from 'lucide-react-native'
import { useAnalysisQueue } from '../store/listing.store'
import { font, line, radius, space, theme } from '../theme'

/**
 * Rappel discret sur l'accueil : des rédactions tournent en fond (ou des
 * brouillons attendent d'être validés). Tap → /processing. Masqué si la file
 * est vide. Garantit qu'une annonce « enchaînée » n'est jamais perdue de vue.
 */
export function AnalysisQueueBanner() {
  const router = useRouter()
  const jobs = useAnalysisQueue(s => s.jobs)

  const running = jobs.filter(j => j.status === 'running').length
  const ready = jobs.filter(j => j.status === 'ready').length
  const failed = jobs.filter(j => j.status === 'failed').length
  if (running + ready + failed === 0) return null

  const parts: string[] = []
  if (running > 0) parts.push(`${running} en cours`)
  if (ready > 0) parts.push(`${ready} prête${ready > 1 ? 's' : ''}`)
  if (failed > 0) parts.push(`${failed} à reprendre`)

  const hasReady = ready > 0
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Rédactions en cours — ${parts.join(', ')}`}
      onPress={() => router.push('/processing')}
      style={({ pressed }) => [styles.banner, hasReady && styles.bannerReady, pressed && styles.pressed]}
    >
      <View style={[styles.icon, hasReady && styles.iconReady]}>
        {hasReady ? (
          <Sparkles size={font.lead} color={theme.onDark} />
        ) : (
          <Loader size={font.lead} color={theme.onDark} />
        )}
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>
          {ready > 0 ? 'Des annonces sont prêtes' : 'Rédaction en cours'}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {parts.join(' · ')}
        </Text>
      </View>
      <ChevronRight size={space[5]} color={theme.muted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    marginHorizontal: space[4],
    marginBottom: space[3],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
  },
  bannerReady: { borderColor: theme.bouteille },
  pressed: { opacity: 0.85 },
  icon: {
    width: space[6],
    height: space[6],
    borderRadius: radius.pill,
    backgroundColor: theme.faience,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconReady: { backgroundColor: theme.bouteille },
  textWrap: { flex: 1, gap: space[1] / 2 },
  title: { fontSize: font.body, lineHeight: line.body, fontWeight: '700', color: theme.ink },
  sub: { fontSize: font.small, lineHeight: line.small, color: theme.muted },
})
