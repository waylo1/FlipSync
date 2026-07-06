import { FlatList, RefreshControl, StyleSheet, View } from 'react-native'
import { Camera } from 'lucide-react-native'
import { API_BASE, ApiListing, api } from '../../src/services/api'
import { useApiResource } from '../../src/hooks/useApiResource'
import { formatRelativeFr } from '../../src/lib/time'
import { space, theme } from '../../src/theme'
import { ScreenHeader } from '../../src/ui/ScreenHeader'
import { EmptyState } from '../../src/ui/EmptyState'
import { ErrorBanner } from '../../src/ui/ErrorBanner'
import { Skeleton } from '../../src/ui/Skeleton'
import { ListingCard, ListingRow } from '../../src/components/ListingCard'

/** Réponse serveur → ligne d'affichage. Le statut vient du serveur, jamais déduit. */
function toRow(listing: ApiListing): ListingRow {
  const first = listing.photos[0]
  return {
    id: listing.id,
    titre: listing.titre ?? 'Annonce en préparation',
    // Prix montré : celui choisi par l'utilisateur, sinon l'estimation haute de l'IA.
    prixCents: listing.prixPublie ?? listing.prixHaut,
    status: listing.status,
    failureReason: listing.failureReason,
    publishedLbc: listing.publishedLbc,
    publishedVinted: listing.publishedVinted,
    quand: formatRelativeFr(listing.updatedAt),
    thumbUri: first !== undefined ? `${API_BASE}${first.url}` : null,
  }
}

const SKELETON_KEYS = ['s1', 's2', 's3'] as const

export default function ListingsScreen() {
  const { data, loading, refreshing, error, retry, refresh } = useApiResource(api.getListings)
  const rows = data?.listings.map(toRow) ?? null

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Mes annonces" />

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
        <View style={styles.skeletons}>
          {SKELETON_KEYS.map(k => (
            <Skeleton key={k} height={space[8] + space[5]} round="lg" />
          ))}
        </View>
      ) : (
        <FlatList
          data={rows ?? []}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <ListingCard item={item} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={theme.goldDark}
              colors={[theme.goldDark]}
            />
          }
          ListHeaderComponent={
            error !== null ? (
              <ErrorBanner message={`Actualisation impossible (${error}).`} onRetry={retry} />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={<Camera size={space[6]} color={theme.goldDark} />}
              title="Votre étal est vide"
              body="Prenez une photo de votre objet — on s'occupe de rédiger l'annonce."
            />
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  list: { paddingHorizontal: space[4], paddingBottom: space[6], gap: space[3] },
  skeletons: { paddingHorizontal: space[4], gap: space[3] },
  bannerWrap: { paddingHorizontal: space[4] },
})
