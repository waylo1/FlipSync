import { useCallback, useEffect, useState } from 'react'
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { AlertTriangle, ArrowLeft, Pencil, RotateCcw } from 'lucide-react-native'
import { ItemCondition, ListingStatus } from '@flipsync/core'
import { API_BASE, ApiError, ApiListing, api } from '../src/services/api'
import { LISTING_EDITABLE_STATUSES } from '../src/store/listing.store'
import { MIN_TOUCH, font, formatEur, line, radius, space, theme } from '../src/theme'
import { AuthImage } from '../src/components/AuthImage'
import { StatusBadge } from '../src/components/StatusBadge'
import { PipelineRail } from '../src/components/PipelineRail'
import { AmountText } from '../src/ui/AmountText'
import { Badge } from '../src/ui/Badge'
import { Button } from '../src/ui/Button'
import { ErrorBanner } from '../src/ui/ErrorBanner'
import { Skeleton } from '../src/ui/Skeleton'

const CONDITION_LABELS: Readonly<Record<ItemCondition, string>> = {
  [ItemCondition.neuf]: 'Neuf',
  [ItemCondition.tres_bon]: 'Très bon état',
  [ItemCondition.bon]: 'Bon état',
  [ItemCondition.correct]: 'État correct',
}

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  LISTING_NOT_FOUND: 'Annonce introuvable.',
  TIMEOUT: 'Le serveur met trop de temps à répondre — réessayez.',
  NETWORK_ERROR: 'Pas de connexion — réessayez.',
}

/** Échecs couverts par le remboursement automatique (CLAUDE.md). */
const REFUNDED_STATUSES: readonly ListingStatus[] = [
  ListingStatus.AI_FAILED,
  ListingStatus.PUBLISH_FAILED,
]

const PHOTO_SIZE = Dimensions.get('window').width

export default function ListingViewScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [listing, setListing] = useState<ApiListing | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!id) return
    setLoadError(null)
    api
      .getListing(id)
      .then(({ listing: l }) => setListing(l))
      .catch(err => setLoadError(err instanceof ApiError ? err.code : 'UNKNOWN'))
  }, [id])

  useEffect(() => load(), [load])

  if (!id) return <Redirect href="/(tabs)" />

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retour"
          onPress={() => router.back()}
          hitSlop={space[2]}
          style={styles.back}
        >
          <ArrowLeft size={space[5]} color={theme.ink} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {listing?.titre ?? 'Annonce'}
        </Text>
      </View>

      {loadError !== null ? (
        <View style={styles.center}>
          <ErrorBanner
            message={ERROR_MESSAGES[loadError] ?? `Chargement impossible (${loadError}).`}
            onRetry={load}
          />
        </View>
      ) : listing === null ? (
        <View style={styles.loading}>
          <Skeleton height={PHOTO_SIZE} round="md" />
          <Skeleton height={space[8]} />
          <Skeleton height={space[7]} />
        </View>
      ) : (
        <Detail
          listing={listing}
          onEdit={() => router.push({ pathname: '/listing-edit', params: { id: listing.id } })}
        />
      )}
    </View>
  )
}

function Detail({ listing, onEdit }: { listing: ApiListing; onEdit: () => void }) {
  const editable = LISTING_EDITABLE_STATUSES.includes(listing.status)
  const refunded = REFUNDED_STATUSES.includes(listing.status)
  const price = listing.prixPublie ?? listing.prixHaut

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Galerie photos — défilement horizontal paginé (à la Vinted). */}
      {listing.photos.length > 0 ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.gallery}
        >
          {listing.photos.map(photo => (
            <AuthImage
              key={photo.id}
              uri={`${API_BASE}${photo.url}`}
              style={styles.photo}
              accessibilityLabel={`Photo ${photo.order + 1} de ${listing.titre ?? 'l’annonce'}`}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={[styles.photo, styles.photoFallback]}>
          <Text style={styles.photoLetter}>{(listing.titre ?? '?').charAt(0)}</Text>
        </View>
      )}

      <View style={styles.pad}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{listing.titre ?? 'Annonce en préparation'}</Text>
          {price !== null && <AmountText cents={price} size={font.title} color={theme.ink} />}
        </View>

        <View style={styles.statusRow}>
          <StatusBadge status={listing.status} />
        </View>
        <PipelineRail status={listing.status} />

        {listing.failureReason !== null && (
          <View accessibilityRole="alert" style={styles.failureRow}>
            <AlertTriangle size={font.small} color={theme.brique} />
            <Text style={styles.failureText}>{listing.failureReason}</Text>
          </View>
        )}
        {refunded && (
          <View style={styles.refundRow}>
            <RotateCcw size={font.caption} color={theme.bouteille} />
            <Text style={styles.refundText}>Remboursé automatiquement — rien à faire.</Text>
          </View>
        )}

        {listing.description !== null && (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>Description</Text>
            <Text style={styles.description}>{listing.description}</Text>
          </View>
        )}

        <View style={styles.metaGrid}>
          {listing.marque !== null && <MetaCell label="Marque" value={listing.marque} />}
          {listing.etat !== null && (
            <MetaCell label="État" value={CONDITION_LABELS[listing.etat]} />
          )}
          {listing.prixPlancher !== null && listing.prixHaut !== null && (
            <MetaCell
              label="Estimation IA"
              value={`${formatEur(listing.prixPlancher)} – ${formatEur(listing.prixHaut)}`}
            />
          )}
        </View>

        {(listing.publishedLbc || listing.publishedVinted) && (
          <View style={styles.block}>
            <Text style={styles.blockLabel}>En ligne sur</Text>
            <View style={styles.platformRow}>
              {listing.publishedLbc && (
                <Badge label="Leboncoin" fg={theme.goldDark} bg={theme.goldSoft} />
              )}
              {listing.publishedVinted && (
                <Badge label="Vinted" fg={theme.goldDark} bg={theme.goldSoft} />
              )}
            </View>
          </View>
        )}

        {editable && (
          <Button
            label="Modifier l'annonce"
            icon={<Pencil size={font.lead} color={theme.onDark} />}
            onPress={onEdit}
            style={styles.editBtn}
          />
        )}
      </View>
    </ScrollView>
  )
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingTop: space[7],
    paddingBottom: space[3],
  },
  back: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: font.title, lineHeight: line.title, fontWeight: '700', color: theme.ink },

  center: { flex: 1, padding: space[5] },
  loading: { padding: space[5], gap: space[3] },
  content: { paddingBottom: space[7] },

  gallery: { width: PHOTO_SIZE, height: PHOTO_SIZE },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, backgroundColor: theme.kraft },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  photoLetter: { fontSize: font.balance, fontWeight: '700', color: theme.goldDark },

  pad: { padding: space[5], gap: space[3] },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[3],
  },
  title: { flex: 1, fontSize: font.title, lineHeight: line.title, fontWeight: '700', color: theme.ink },
  statusRow: { flexDirection: 'row' },

  failureRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  failureText: { flex: 1, fontSize: font.small, lineHeight: line.small, fontWeight: '600', color: theme.brique },
  refundRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  refundText: { flex: 1, fontSize: font.small, lineHeight: line.small, fontWeight: '600', color: theme.bouteille },

  block: { gap: space[1], marginTop: space[2] },
  blockLabel: { fontSize: font.small, fontWeight: '700', color: theme.muted },
  description: { fontSize: font.body, lineHeight: line.body, color: theme.ink },

  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginTop: space[2] },
  metaCell: {
    minWidth: space[8] + space[6],
    gap: space[1] / 2,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  metaLabel: { fontSize: font.caption, color: theme.muted },
  metaValue: { fontSize: font.body, fontWeight: '600', color: theme.ink },

  platformRow: { flexDirection: 'row', gap: space[2] },

  editBtn: { marginTop: space[5] },
})
