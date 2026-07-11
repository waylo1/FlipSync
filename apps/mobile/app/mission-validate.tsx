import { useCallback, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { ShieldAlert, X } from 'lucide-react-native'
import { ApiError, api } from '../src/services/api'
import { useApiResource } from '../src/hooks/useApiResource'
import { ValidationVariant, validationVariant } from '../src/lib/mission-dashboard'
import { font, line, radius, space, theme } from '../src/theme'
import { AmountText } from '../src/ui/AmountText'
import { Button } from '../src/ui/Button'
import { Card } from '../src/ui/Card'
import { ErrorBanner } from '../src/ui/ErrorBanner'
import { Skeleton } from '../src/ui/Skeleton'

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  MISSION_NOT_FOUND: 'Mission introuvable.',
  TIMEOUT: 'Le serveur met trop de temps à répondre — réessayez.',
  NETWORK_ERROR: 'Pas de connexion — réessayez.',
}

/**
 * S5 — « Validation requise » : le coup de marteau (COMMISSAIRE_PRISEUR_PLAN.md
 * §5.5, Lot 6). Feuille modale ouverte depuis la carte moutarde de S4. Trois
 * variantes dérivées de `validationVariant` (offre/prix mini, alerte sécurité,
 * cas complexe) ; « Accepter » applique R4 côté serveur (VENDU). Si l'offre a
 * été retirée entre-temps, `validationVariant` renvoie null et on l'affiche
 * clairement plutôt que de laisser accepter une offre morte.
 */
export default function MissionValidateScreen() {
  const router = useRouter()
  const { missionId } = useLocalSearchParams<{ missionId: string }>()
  const [busy, setBusy] = useState(false)

  const fetchMission = useCallback(() => api.getMission(missionId), [missionId])
  const { data, loading, error, retry } = useApiResource(fetchMission)

  if (!missionId) return <Redirect href="/(tabs)" />

  const resolve = async (action: 'ACCEPT' | 'CONTINUE' | 'DECLINE') => {
    setBusy(true)
    try {
      await api.resolveValidation(missionId, action)
      // Accepter → vente confirmée : la récompense S6, pas juste une fermeture de feuille (§5.5/§5.6).
      if (action === 'ACCEPT') router.replace({ pathname: '/mission-recap', params: { missionId } })
      else router.back()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN'
      if (code === 'VALIDATION_NOT_PENDING') {
        Alert.alert('Cette offre a été retirée.', undefined, [{ text: 'Fermer', onPress: () => router.back() }])
      } else {
        Alert.alert('Action impossible', ERROR_MESSAGES[code] ?? `Réessayez (${code}).`)
      }
    } finally {
      setBusy(false)
    }
  }

  const variant = data !== null ? validationVariant(data.mission) : undefined

  return (
    <View style={styles.screen}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fermer"
        onPress={() => router.back()}
        hitSlop={space[2]}
        style={styles.closeButton}
      >
        <X size={space[5]} color={theme.ink} />
      </Pressable>

      {error !== null && data === null ? (
        <View style={styles.center}>
          <ErrorBanner message={ERROR_MESSAGES[error] ?? `Chargement impossible (${error}).`} onRetry={retry} />
        </View>
      ) : loading && data === null ? (
        <View style={styles.loading}>
          <Skeleton height={space[8] + space[6]} round="lg" />
          <Skeleton height={space[6]} round="sm" />
        </View>
      ) : variant === undefined ? null : variant === null ? (
        <Withdrawn onClose={() => router.back()} />
      ) : (
        <Sheet variant={variant} busy={busy} onResolve={resolve} onClose={() => router.back()} />
      )}
    </View>
  )
}

function Withdrawn({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.content}>
      <Text style={styles.title} accessibilityLiveRegion="polite">
        Cette offre a été retirée.
      </Text>
      <Button label="Fermer" variant="ghost" onPress={onClose} />
    </View>
  )
}

function Sheet({
  variant,
  busy,
  onResolve,
  onClose,
}: {
  variant: ValidationVariant
  busy: boolean
  onResolve: (action: 'ACCEPT' | 'CONTINUE' | 'DECLINE') => void
  onClose: () => void
}) {
  if (variant.kind === 'OFFER') {
    return (
      <View style={styles.content}>
        <Text style={styles.title} accessibilityLiveRegion="polite">
          L’IA a une offre pour vous
        </Text>

        <Card style={styles.offerCard}>
          <AmountText cents={variant.amount} size={font.display} color={theme.ink} style={styles.offerAmount} />
          <Text style={styles.offerBuyer}>Offre de « {variant.buyerName} »</Text>
        </Card>

        {variant.atFloor && (
          <View style={styles.floorBanner}>
            <Text style={styles.floorBannerText}>C’est votre plancher — l’IA n’ira pas plus haut.</Text>
          </View>
        )}

        <View style={styles.actions}>
          <Button
            label={`Accepter — vendre ${(variant.amount / 100).toFixed(2).replace('.', ',')} €`}
            variant="primary"
            loading={busy}
            onPress={() => onResolve('ACCEPT')}
            style={styles.acceptButton}
          />
          <Button label="Laisser l’IA continuer" variant="ghost" loading={busy} onPress={() => onResolve('CONTINUE')} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refuser cette offre"
            onPress={() => onResolve('DECLINE')}
            disabled={busy}
            style={styles.declineLink}
          >
            <Text style={styles.declineText}>Refuser cette offre</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  if (variant.kind === 'SECURITY_ALERT') {
    return (
      <View style={styles.content}>
        <ShieldAlert size={space[6]} color={theme.brique} />
        <Text style={styles.title} accessibilityLiveRegion="polite">
          Un acheteur sort du circuit sécurisé
        </Text>
        <Text style={styles.body}>
          « {variant.buyerName} » propose de continuer en dehors de la plateforme. Restez sur le circuit sécurisé —
          c’est ce qui vous protège.
        </Text>
        <View style={styles.actions}>
          <Button label="Bloquer (recommandé)" variant="danger" loading={busy} onPress={() => onResolve('DECLINE')} />
          <Button label="Voir le message" variant="ghost" onPress={onClose} />
        </View>
      </View>
    )
  }

  return (
    <View style={styles.content}>
      <Text style={styles.title} accessibilityLiveRegion="polite">
        L’IA ne sait pas trancher
      </Text>
      <Text style={styles.body}>Cas hors mandat signalé par « {variant.buyerName} ».</Text>
      <View style={styles.actions}>
        <Button label="Répondre moi-même" variant="ghost" onPress={onClose} />
        <Button label="Refuser" variant="danger" loading={busy} onPress={() => onResolve('DECLINE')} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  center: { flex: 1, padding: space[5] },
  loading: { padding: space[5], gap: space[3] },

  closeButton: { alignSelf: 'flex-end', padding: space[4], minWidth: space[6], minHeight: space[6] },

  content: { paddingHorizontal: space[5], paddingBottom: space[6], gap: space[4] },
  title: { fontSize: font.heading, lineHeight: line.heading, fontWeight: '700', color: theme.ink },
  body: { fontSize: font.small, lineHeight: line.small, color: theme.muted },

  offerCard: { alignItems: 'center', gap: space[1] },
  offerAmount: { textAlign: 'center' },
  offerBuyer: { fontSize: font.small, color: theme.muted },

  floorBanner: {
    backgroundColor: theme.moutardeSoft,
    borderColor: theme.moutardeBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[3],
  },
  floorBannerText: { fontSize: font.small, fontWeight: '700', color: theme.moutarde },

  actions: { gap: space[3], marginTop: space[2] },
  acceptButton: { backgroundColor: theme.bouteille },
  declineLink: { alignItems: 'center', padding: space[2] },
  declineText: { fontSize: font.small, fontWeight: '600', color: theme.brique },
})
