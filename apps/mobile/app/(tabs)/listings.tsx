import { FlatList, StyleSheet, Text, View } from 'react-native'
import { Camera } from 'lucide-react-native'
import { ListingStatus } from '@flipsync/core'
import { font, space, theme } from '../../src/theme'
import { ScreenHeader } from '../../src/ui/ScreenHeader'
import { EmptyState } from '../../src/ui/EmptyState'
import { ListingCard, ListingRow } from '../../src/components/ListingCard'

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

export default function ListingsScreen() {
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Mes annonces" />

      <FlatList
        data={MOCK_LISTINGS}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <ListingCard item={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon={<Camera size={space[6]} color={theme.goldDark} />}
            title="Votre étal est vide"
            body="Prenez une photo de votre objet — on s'occupe de rédiger l'annonce."
          />
        }
        ListFooterComponent={
          <Text style={styles.mockNote}>Données de démonstration — branchement API à venir.</Text>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  list: { paddingHorizontal: space[4], paddingBottom: space[6], gap: space[3] },
  mockNote: {
    textAlign: 'center',
    fontSize: font.caption,
    color: theme.muted,
    marginTop: space[4],
  },
})
