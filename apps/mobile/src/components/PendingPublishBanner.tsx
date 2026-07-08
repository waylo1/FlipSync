import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { CircleDashed } from 'lucide-react-native'
import { ApiError, api } from '../services/api'
import { usePendingPublish } from '../store/listing.store'
import { font, line, space, theme } from '../theme'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

/**
 * Bandeau « publication interrompue » : la séquence create→validate a été coupée
 * (réseau, crash). Rien n'a été débité — Reprendre repart de l'étape suivante,
 * Abandonner annule côté serveur (gratuit, pré-commit) puis oublie.
 */
export function PendingPublishBanner({ onCancelled }: { onCancelled: () => void }) {
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

const styles = StyleSheet.create({
  pendingCard: {
    marginHorizontal: space[4],
    marginBottom: space[3],
    backgroundColor: theme.moutardeSoft,
    borderColor: theme.moutardeBorder,
    gap: space[2],
  },
  pendingHeader: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  pendingTitle: { fontSize: font.body, fontWeight: '700', color: theme.moutarde },
  pendingBody: { fontSize: font.small, lineHeight: line.small, color: theme.moutarde },
  pendingActions: { flexDirection: 'row', gap: space[2], marginTop: space[1] },
  pendingBtn: { flex: 1 },
})
