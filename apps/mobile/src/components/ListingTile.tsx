import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { AlertTriangle } from 'lucide-react-native'
import { STATUS_META, font, line, radius, shadow, space, theme } from '../theme'
import { AmountText } from '../ui/AmountText'
import { Badge } from '../ui/Badge'
import { FadeInUp } from '../ui/FadeInUp'
import { Tappable } from '../ui/Tappable'
import { AuthImage } from './AuthImage'
import { ListingRow } from './ListingCard'

/**
 * Tuile de grille (accueil) — vignette + prix + statut. Tap → fiche détail.
 * Entrée staggerée (index * 40 ms, plafonné) + enfoncement ressort au toucher.
 */
export function ListingTile({ item, index = 0 }: { item: ListingRow; index?: number }) {
  const router = useRouter()
  const meta = STATUS_META[item.status]
  const failed = item.failureReason !== null

  return (
    <FadeInUp delay={Math.min(index * 40, 240)} style={styles.wrap}>
      <Tappable
        accessibilityLabel={`${item.titre}, ${meta.label}`}
        onPress={() => router.push({ pathname: '/listing-view', params: { id: item.id } })}
        style={styles.tile}
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
      </Tappable>
    </FadeInUp>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  tile: {
    backgroundColor: theme.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    ...shadow.surface,
  },

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
