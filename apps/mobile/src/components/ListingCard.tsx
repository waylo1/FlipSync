import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { AlertTriangle, ChevronRight, RotateCcw } from 'lucide-react-native'
import { ListingStatus } from '@flipsync/core'
import { LISTING_EDITABLE_STATUSES } from '../store/listing.store'
import { STATUS_META, font, line, radius, space, theme } from '../theme'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { AmountText } from '../ui/AmountText'
import { AuthImage } from './AuthImage'
import { StatusBadge } from './StatusBadge'
import { PipelineRail } from './PipelineRail'

export interface ListingRow {
  id: string
  titre: string
  /** Centimes Int — null tant qu'aucun prix n'existe (avant brouillon IA). */
  prixCents: number | null
  status: ListingStatus
  failureReason: string | null
  publishedLbc: boolean
  publishedVinted: boolean
  quand: string
  /** URL absolue de la première photo — vignette lettre si absente. */
  thumbUri: string | null
}

/** Échecs couverts par le remboursement automatique (CLAUDE.md). */
const REFUNDED_STATUSES: readonly ListingStatus[] = [
  ListingStatus.AI_FAILED,
  ListingStatus.PUBLISH_FAILED,
]

/** Carte annonce — le PRIX est roi, l'état toujours dit, l'échec toujours remboursé. */
export function ListingCard({ item }: { item: ListingRow }) {
  const router = useRouter()
  const meta = STATUS_META[item.status]
  const refunded = REFUNDED_STATUSES.includes(item.status)
  const editable = LISTING_EDITABLE_STATUSES.includes(item.status)

  const card = (
    <Card style={styles.card}>
      {/* Vignette : première photo du listing (JWT joint — /uploads protégé), lettre kraft sinon. */}
      {item.thumbUri !== null ? (
        <AuthImage
          uri={item.thumbUri}
          style={styles.thumb}
          accessibilityLabel={`Photo de ${item.titre}`}
        />
      ) : (
        <View style={styles.thumb}>
          <Text style={styles.thumbLetter}>{item.titre.charAt(0)}</Text>
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {item.titre}
          </Text>
          {/* Le prix domine la ligne : un cran au-dessus du titre. */}
          {item.prixCents !== null && (
            <AmountText cents={item.prixCents} size={font.lead} color={theme.ink} />
          )}
        </View>

        <View style={styles.metaRow}>
          <StatusBadge status={item.status} />
          <View style={styles.metaRight}>
            <Text style={styles.when}>{item.quand}</Text>
            {editable && <ChevronRight size={font.small} color={theme.muted} />}
          </View>
        </View>

        <PipelineRail status={item.status} />

        {item.failureReason !== null && (
          <View accessibilityRole="alert" style={styles.failureRow}>
            <AlertTriangle size={font.small} color={meta.fg} />
            <Text style={[styles.failureText, { color: meta.fg }]}>{item.failureReason}</Text>
          </View>
        )}
        {refunded && (
          <View style={styles.refundRow}>
            <RotateCcw size={font.caption} color={theme.bouteille} />
            <Text style={styles.refundText}>Remboursé automatiquement — rien à faire.</Text>
          </View>
        )}

        {(item.publishedLbc || item.publishedVinted) && (
          <View style={styles.platformRow}>
            {item.publishedLbc && (
              <Badge label="Leboncoin" fg={theme.goldDark} bg={theme.goldSoft} />
            )}
            {item.publishedVinted && (
              <Badge label="Vinted" fg={theme.goldDark} bg={theme.goldSoft} />
            )}
          </View>
        )}
      </View>
    </Card>
  )

  if (!editable) return card

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Modifier ou annuler « ${item.titre} »`}
      onPress={() => router.push({ pathname: '/listing-edit', params: { id: item.id } })}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {card}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: space[3], padding: space[3] },
  thumb: {
    width: space[7] + space[2],
    height: space[7] + space[2],
    borderRadius: radius.md,
    backgroundColor: theme.kraft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbLetter: { fontSize: font.title, fontWeight: '700', color: theme.goldDark },

  body: { flex: 1, gap: space[2] },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space[2] },
  title: { flex: 1, fontSize: font.body, lineHeight: line.body, fontWeight: '600', color: theme.ink },

  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaRight: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  when: { fontSize: font.caption, color: theme.muted },
  pressed: { opacity: 0.85 },

  failureRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  failureText: { flex: 1, fontSize: font.caption, lineHeight: line.caption, fontWeight: '600' },
  refundRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  refundText: { flex: 1, fontSize: font.caption, lineHeight: line.caption, color: theme.bouteille, fontWeight: '600' },

  platformRow: { flexDirection: 'row', gap: space[2] },
})
