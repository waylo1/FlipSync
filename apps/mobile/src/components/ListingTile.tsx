import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { AlertTriangle } from 'lucide-react-native'
import { STATUS_META, font, line, radius, space, theme } from '../theme'
import { AmountText } from '../ui/AmountText'
import { Badge } from '../ui/Badge'
import { AuthImage } from './AuthImage'
import { ListingRow } from './ListingCard'

/** Tuile de grille (accueil) — vignette + prix + statut. Tap → fiche détail. */
export function ListingTile({ item }: { item: ListingRow }) {
  const router = useRouter()
  const meta = STATUS_META[item.status]
  const failed = item.failureReason !== null

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.titre}, ${meta.label}`}
      onPress={() => router.push({ pathname: '/listing-view', params: { id: item.id } })}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={styles.thumbWrap}>
        {item.thumbUri !== null ? (
          <AuthImage uri={item.thumbUri} style={styles.thumb} accessibilityLabel={`Photo de ${item.titre}`} />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]}>
            <Text style={styles.thumbLetter}>{item.titre.charAt(0)}</Text>
          </View>
        )}
        <View style={styles.badgeWrap}>
          <Badge label={meta.label} fg={meta.fg} bg={meta.bg} />
        </View>
        {failed && (
          <View style={styles.alertWrap}>
            <AlertTriangle size={font.small} color={theme.onDark} />
          </View>
        )}
        {/* Prix en overlay bas de vignette (à la Vinted) — voile sombre pour lisibilité. */}
        {item.prixCents !== null && (
          <View style={styles.priceWrap}>
            <AmountText cents={item.prixCents} size={font.body} color={theme.onDark} />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {item.titre}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: theme.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.85 },

  thumbWrap: { aspectRatio: 1, backgroundColor: theme.kraft },
  thumb: { width: '100%', height: '100%' },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  thumbLetter: { fontSize: font.display, fontWeight: '700', color: theme.goldDark },
  badgeWrap: { position: 'absolute', top: space[2], left: space[2] },
  alertWrap: {
    position: 'absolute',
    top: space[2],
    right: space[2],
    backgroundColor: theme.scrimBrique,
    borderRadius: radius.pill,
    padding: space[1],
  },
  priceWrap: {
    position: 'absolute',
    bottom: space[2],
    right: space[2],
    backgroundColor: theme.scrim,
    borderRadius: radius.sm,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },

  body: { padding: space[3] },
  title: { fontSize: font.small, lineHeight: line.small, color: theme.ink },
})
