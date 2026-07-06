import { useState } from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Camera, CircleDashed } from 'lucide-react-native'
import { API_BASE, ApiError, ApiListing, api } from '../../src/services/api'
import { useApiResource } from '../../src/hooks/useApiResource'
import { usePendingPublish } from '../../src/store/listing.store'
import { formatRelativeFr } from '../../src/lib/time'
import { font, space, theme } from '../../src/theme'
import { ScreenHeader } from '../../src/ui/ScreenHeader'
import { Button } from '../../src/ui/Button'
import { Card } from '../../src/ui/Card'
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

/**
 * Bandeau « publication interrompue » : la séquence create→validate a été coupée
 * (réseau, crash). Rien n'a été débité — Reprendre repart de l'étape suivante,
 * Abandonner annule côté serveur (gratuit, pré-commit) puis oublie.
 */
function PendingPublishBanner({ onCancelled }: { onCancelled: () => void }) {
  const router = useRouter()
  const pending = usePendingPublish(s => s.pending)
  const clearPending = usePendingPublish(s => s.clearPending)
  const [cancelling, setCancelling] = useState(false)

  if (pending === null) return null

  const abandon = async () => {
    setCancelling(true)
    try {
      await api.cancel(pending.listingId)
      clearPending()
      onCancelled()
    } catch (err) {
      // Déjà annulée/traitée côté serveur (ou disparue) → l'état serveur fait foi.
      if (err instanceof ApiError && (err.code === 'INVALID_TRANSITION' || err.code === 'LISTING_NOT_FOUND')) {
        clearPending()
        onCancelled()
      }
      // Erreur réseau : on garde le bandeau — nouvel essai possible.
    } finally {
      setCancelling(false)
    }
  }

  return (
    <Card style={styles.pendingCard}>
      <View style={styles.pendingHeader}>
        <CircleDashed size={font.lead} color={theme.moutarde} />
        <Text style={styles.pendingTitle}>Publication interrompue</Text>
      </View>
      <Text style={styles.pendingBody}>
        « {pending.draft.titre} » n'a pas fini d'être publiée. Rien n'a été débité.
      </Text>
      <View style={styles.pendingActions}>
        <Button label="Reprendre" onPress={() => router.push('/validate')} style={styles.pendingBtn} />
        <Button
          label="Abandonner"
          variant="ghost"
          loading={cancelling}
          onPress={() => void abandon()}
          style={styles.pendingBtn}
        />
      </View>
    </Card>
  )
}

export default function ListingsScreen() {
  const { data, loading, refreshing, error, retry, refresh } = useApiResource(api.getListings)
  const rows = data?.listings.map(toRow) ?? null

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Mes annonces" />

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

  pendingCard: {
    marginHorizontal: space[4],
    marginBottom: space[3],
    backgroundColor: theme.moutardeSoft,
    borderColor: theme.moutardeBorder,
    gap: space[2],
  },
  pendingHeader: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  pendingTitle: { fontSize: font.body, fontWeight: '700', color: theme.moutarde },
  pendingBody: { fontSize: font.small, color: theme.moutarde, lineHeight: space[4] + space[1] },
  pendingActions: { flexDirection: 'row', gap: space[2] },
  pendingBtn: { flex: 1 },
})
