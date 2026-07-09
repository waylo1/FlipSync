import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Camera, Search } from 'lucide-react-native'
import { ListingStatus } from '@flipsync/core'
import { API_BASE, ApiListing, api } from '../../src/services/api'
import { useApiResource } from '../../src/hooks/useApiResource'
import { useAuthStore } from '../../src/store/auth.store'
import { formatRelativeFr } from '../../src/lib/time'
import { font, radius, space, theme } from '../../src/theme'
import { ScreenHeader } from '../../src/ui/ScreenHeader'
import { Avatar } from '../../src/ui/Avatar'
import { EmptyState } from '../../src/ui/EmptyState'
import { ErrorBanner } from '../../src/ui/ErrorBanner'
import { Skeleton } from '../../src/ui/Skeleton'
import { ListingRow } from '../../src/components/ListingCard'
import { ListingTile } from '../../src/components/ListingTile'
import { PendingPublishBanner } from '../../src/components/PendingPublishBanner'
import { AnalysisQueueBanner } from '../../src/components/AnalysisQueueBanner'

/** Réponse serveur → ligne d'affichage. Le statut vient du serveur, jamais déduit. */
function toRow(listing: ApiListing): ListingRow {
  const first = listing.photos[0]
  return {
    id: listing.id,
    titre: listing.titre ?? 'Annonce en préparation',
    prixCents: listing.prixPublie ?? listing.prixHaut,
    status: listing.status,
    failureReason: listing.failureReason,
    publishedLbc: listing.publishedLbc,
    publishedVinted: listing.publishedVinted,
    quand: formatRelativeFr(listing.updatedAt),
    thumbUri: first !== undefined ? `${API_BASE}${first.url}` : null,
  }
}

type Filter = 'TOUT' | 'EN_LIGNE' | 'A_VALIDER' | 'EN_COURS' | 'ANNULEES'

const FILTERS: Readonly<Record<Filter, { label: string; statuses: readonly ListingStatus[] | null }>> = {
  TOUT: { label: 'Tout', statuses: null },
  EN_LIGNE: { label: 'En ligne', statuses: [ListingStatus.PUBLISHED] },
  A_VALIDER: { label: 'À valider', statuses: [ListingStatus.DRAFT_READY] },
  EN_COURS: {
    label: 'En cours',
    statuses: [
      ListingStatus.AUTHORIZED,
      ListingStatus.AI_PROCESSING,
      ListingStatus.USER_VALIDATED,
      ListingStatus.QUEUED,
    ],
  },
  ANNULEES: { label: 'Annulées', statuses: [ListingStatus.USER_CANCELLED] },
}
const FILTER_ORDER: readonly Filter[] = ['TOUT', 'EN_LIGNE', 'A_VALIDER', 'EN_COURS', 'ANNULEES']

const SKELETON_KEYS = ['s1', 's2', 's3', 's4'] as const
// Même géométrie que la grille réelle (2 colonnes, gap space[3], tuile carrée)
// pour qu'aucun saut de layout ne se produise au passage skeleton → données.
const SKELETON_TILE_WIDTH = (Dimensions.get('window').width - space[4] * 2 - space[3]) / 2

export default function HomeScreen() {
  const router = useRouter()
  const email = useAuthStore(s => s.email)
  const [filter, setFilter] = useState<Filter>('TOUT')
  const [query, setQuery] = useState('')

  // L'API exclut les annonces annulées par défaut ; le filtre « Annulées » les redemande explicitement.
  const fetchListings = useCallback(
    () => api.getListings({ includeCancelled: filter === 'ANNULEES' }),
    [filter],
  )
  const { data, loading, refreshing, error, retry, refresh } = useApiResource(fetchListings)

  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) retry()
    else mounted.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const rows = useMemo(() => {
    if (data === null) return null
    const statuses = FILTERS[filter].statuses
    const q = query.trim().toLowerCase()
    return data.listings
      .map(toRow)
      .filter(r => statuses === null || statuses.includes(r.status))
      .filter(r => q === '' || r.titre.toLowerCase().includes(q))
  }, [data, filter, query])

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="FlipSync"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mon profil"
            onPress={() => router.push('/profile')}
            hitSlop={space[2]}
            style={({ pressed }) => pressed && styles.avatarPressed}
          >
            <Avatar email={email} />
          </Pressable>
        }
      />

      <View style={styles.searchWrap}>
        <Search size={space[4]} color={theme.goldDark} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher une annonce"
          placeholderTextColor={theme.muted}
          style={styles.searchInput}
          accessibilityLabel="Rechercher une annonce"
          returnKeyType="search"
        />
        {/* Raccourci capture (pattern Vinted/eBay : caméra dans la barre de recherche). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Photographier un objet à vendre"
          onPress={() => router.push('/(tabs)/vendre')}
          hitSlop={space[2]}
          style={({ pressed }) => pressed && styles.cameraPressed}
        >
          <Camera size={space[4] + space[1]} color={theme.goldDark} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
        style={styles.chipsScroll}
      >
        {FILTER_ORDER.map(key => {
          const active = key === filter
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setFilter(key)}
            >
              <View style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {FILTERS[key].label}
                </Text>
              </View>
            </Pressable>
          )
        })}
      </ScrollView>

      <AnalysisQueueBanner />
      <PendingPublishBanner onCancelled={() => void refresh()} />

      {error !== null && rows === null ? (
        <View style={styles.bannerWrap}>
          <ErrorBanner
            message={
              error === 'NETWORK_ERROR'
                ? 'Impossible de joindre le serveur — vérifiez votre connexion.'
                : `Chargement impossible (${error}).`
            }
            onRetry={retry}
          />
        </View>
      ) : loading && rows === null ? (
        <View style={styles.skeletonGrid}>
          {SKELETON_KEYS.map(k => (
            <View key={k} style={styles.skeletonTile}>
              <Skeleton height={SKELETON_TILE_WIDTH} round="md" />
              <Skeleton height={space[3]} width="70%" round="xs" style={styles.skeletonLine} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={rows ?? []}
          keyExtractor={item => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          renderItem={({ item, index }) => <ListingTile item={item} index={index} />}
          contentContainerStyle={styles.grid}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          ListHeaderComponent={
            error !== null ? (
              <ErrorBanner message={`Actualisation impossible (${error}).`} onRetry={retry} />
            ) : null
          }
          ListEmptyComponent={
            query !== '' ? (
              <EmptyState
                icon={<Search size={space[6]} color={theme.goldDark} />}
                title="Aucun résultat"
                body="Aucune annonce ne correspond à cette recherche."
              />
            ) : filter === 'ANNULEES' ? (
              <EmptyState
                icon={<Camera size={space[6]} color={theme.goldDark} />}
                title="Aucune annonce annulée"
                body="Les annonces annulées apparaîtront ici."
              />
            ) : (
              <EmptyState
                icon={<Camera size={space[6]} color={theme.goldDark} />}
                title="Votre étal est vide"
                body="Prenez une photo de votre objet — on s'occupe de rédiger l'annonce."
              />
            )
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  avatarPressed: { opacity: 0.85 },
  cameraPressed: { opacity: 0.6 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginHorizontal: space[4],
    marginBottom: space[2],
    paddingHorizontal: space[4],
    height: space[7],
    borderRadius: radius.pill,
    backgroundColor: theme.goldSoft,
    borderWidth: 1,
    borderColor: theme.border,
  },
  searchInput: { flex: 1, fontSize: font.body, color: theme.ink },

  chipsScroll: { flexGrow: 0, marginBottom: space[2] },
  chipsRow: { paddingHorizontal: space[4] },
  // height + centrage plutôt que padding : padding sur ce Pressable répété
  // corrompt le rendu du texte sur certains devices Android (glyphes tronqués)
  // — bug de rendu isolé empiriquement. L'air horizontal vient donc d'une
  // marginHorizontal sur le Text interne (une marge, jamais un padding).
  chip: {
    marginRight: space[2],
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipActive: { backgroundColor: theme.terracotta, borderColor: theme.terracotta },
  chipText: { fontSize: font.caption, fontWeight: '600', color: theme.muted, marginHorizontal: space[3] },
  chipTextActive: { color: theme.onDark },

  bannerWrap: { paddingHorizontal: space[4] },

  grid: { paddingHorizontal: space[4], paddingBottom: space[6], gap: space[3] },
  gridRow: { gap: space[3] },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: space[4],
    gap: space[3],
  },
  skeletonTile: { width: SKELETON_TILE_WIDTH },
  skeletonLine: { marginTop: space[2] },
})
