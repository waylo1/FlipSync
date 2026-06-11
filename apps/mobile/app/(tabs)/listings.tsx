import { FlatList, StyleSheet, Text, View } from 'react-native'
import { ListingStatus } from '@flipsync/core'
import { MONO, PIPELINE_STEPS, STATUS_META, formatEur, theme } from '../../src/theme'

interface ListingRow {
  id: string
  titre: string
  prixCents: number // centimes Int
  status: ListingStatus
  failureReason: string | null
  publishedLbc: boolean
  publishedVinted: boolean
  quand: string
}

/**
 * MOCK — un listing par état pour valider les 11 rendus de la machine.
 * TODO(Sprint 3) : remplacer par api.getListings() + pull-to-refresh.
 */
const MOCK_LISTINGS: readonly ListingRow[] = [
  { id: 'l1', titre: 'Veste cuir Schott NYC', prixCents: 12000, status: ListingStatus.DRAFT_READY, failureReason: null, publishedLbc: false, publishedVinted: false, quand: 'il y a 5 min' },
  { id: 'l2', titre: 'Lampe laiton années 70', prixCents: 4500, status: ListingStatus.AI_PROCESSING, failureReason: null, publishedLbc: false, publishedVinted: false, quand: 'il y a 7 min' },
  { id: 'l3', titre: 'Vélo Peugeot vintage', prixCents: 18000, status: ListingStatus.PUBLISHED, failureReason: null, publishedLbc: true, publishedVinted: true, quand: 'hier' },
  { id: 'l4', titre: 'Manteau COS laine', prixCents: 9000, status: ListingStatus.QUEUED, failureReason: null, publishedLbc: false, publishedVinted: false, quand: 'il y a 1 h' },
  { id: 'l5', titre: 'Console SNES + 2 manettes', prixCents: 11000, status: ListingStatus.USER_VALIDATED, failureReason: null, publishedLbc: false, publishedVinted: false, quand: 'il y a 2 h' },
  { id: 'l6', titre: 'Sac Longchamp pliage', prixCents: 5500, status: ListingStatus.PUBLISH_FAILED, failureReason: 'MARKETPLACE_TIMEOUT', publishedLbc: false, publishedVinted: false, quand: 'il y a 3 h' },
  { id: 'l7', titre: 'Enceinte Marshall Acton', prixCents: 13000, status: ListingStatus.AUTHORIZED, failureReason: null, publishedLbc: false, publishedVinted: false, quand: 'il y a 10 min' },
  { id: 'l8', titre: 'Polaroid 600 + films', prixCents: 7500, status: ListingStatus.AI_FAILED, failureReason: 'AI_TIMEOUT', publishedLbc: false, publishedVinted: false, quand: 'il y a 4 h' },
  { id: 'l9', titre: 'Chaise Eames réplique', prixCents: 6000, status: ListingStatus.PENDING_AUTH, failureReason: null, publishedLbc: false, publishedVinted: false, quand: 'il y a 1 min' },
  { id: 'l10', titre: 'Blouson Levi’s sherpa', prixCents: 4000, status: ListingStatus.USER_CANCELLED, failureReason: null, publishedLbc: false, publishedVinted: false, quand: 'avant-hier' },
  { id: 'l11', titre: 'Cafetière Moka Bialetti', prixCents: 1500, status: ListingStatus.EXPIRED, failureReason: null, publishedLbc: true, publishedVinted: false, quand: 'il y a 2 mois' },
]

/** Rail de progression du pipeline nominal (7 jalons) — masqué hors pipeline. */
function ProgressRail({ status }: { status: ListingStatus }) {
  const meta = STATUS_META[status]
  if (meta.step === null) return null

  return (
    <View style={styles.rail}>
      {Array.from({ length: PIPELINE_STEPS }, (_, i) => (
        <View
          key={i}
          style={[
            styles.railSegment,
            i < meta.step! && { backgroundColor: meta.fg },
            i === meta.step! - 1 && styles.railSegmentCurrent,
          ]}
        />
      ))}
    </View>
  )
}

function StatusBadge({ status }: { status: ListingStatus }) {
  const meta = STATUS_META[status]
  return (
    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
      <Text style={[styles.badgeText, { color: meta.fg }]}>{meta.label}</Text>
    </View>
  )
}

function ListingCard({ item }: { item: ListingRow }) {
  const meta = STATUS_META[item.status]
  return (
    <View style={styles.card}>
      {/* Vignette placeholder en attendant les photos servies par /uploads. */}
      <View style={styles.thumb}>
        <Text style={styles.thumbLetter}>{item.titre.charAt(0)}</Text>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.titre}
          </Text>
          <Text style={styles.cardPrice}>{formatEur(item.prixCents)}</Text>
        </View>

        <View style={styles.cardMetaRow}>
          <StatusBadge status={item.status} />
          <Text style={styles.cardWhen}>{item.quand}</Text>
        </View>

        <ProgressRail status={item.status} />

        {item.failureReason && (
          <Text style={[styles.failureReason, { color: meta.fg }]}>⚠ {item.failureReason}</Text>
        )}

        {(item.publishedLbc || item.publishedVinted) && (
          <View style={styles.platformRow}>
            {item.publishedLbc && <Text style={styles.platformPill}>Leboncoin</Text>}
            {item.publishedVinted && <Text style={styles.platformPill}>Vinted</Text>}
          </View>
        )}
      </View>
    </View>
  )
}

export default function ListingsScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.heading}>Mes annonces</Text>
        <View style={styles.headerAccent} />
      </View>

      <FlatList
        data={MOCK_LISTINGS}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <ListingCard item={item} />}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          <Text style={styles.mockNote}>Données de démonstration — branchement API à venir.</Text>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  header: { paddingTop: 64, paddingHorizontal: 20, paddingBottom: 12 },
  heading: { fontSize: 26, fontWeight: '800', color: theme.ink },
  headerAccent: { width: 44, height: 4, borderRadius: 2, backgroundColor: theme.gold, marginTop: 6 },

  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  card: {
    flexDirection: 'row',
    backgroundColor: theme.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
    gap: 12,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: theme.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbLetter: { fontSize: 22, fontWeight: '700', color: theme.goldDark },

  cardBody: { flex: 1, gap: 6 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.ink },
  cardPrice: { fontFamily: MONO, fontSize: 14, fontWeight: '700', color: theme.ink },

  cardMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  cardWhen: { fontSize: 11, color: theme.muted },

  rail: { flexDirection: 'row', gap: 3 },
  railSegment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: theme.border },
  railSegmentCurrent: { height: 5, marginTop: -1 },

  failureReason: { fontSize: 12, fontWeight: '500' },
  platformRow: { flexDirection: 'row', gap: 6 },
  platformPill: {
    fontSize: 11,
    color: theme.goldDark,
    backgroundColor: theme.goldSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },

  mockNote: { textAlign: 'center', fontSize: 11, color: theme.muted, marginTop: 16 },
})
