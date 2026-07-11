import { ReactNode, useCallback } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { Camera, MessageCircle, PartyPopper, TrendingUp } from 'lucide-react-native'
import { api } from '../src/services/api'
import { useApiResource } from '../src/hooks/useApiResource'
import { MissionRecap, missionRecap } from '../src/lib/mission-dashboard'
import { font, line, radius, space, theme } from '../src/theme'
import { AmountText } from '../src/ui/AmountText'
import { Button } from '../src/ui/Button'
import { Card } from '../src/ui/Card'
import { ErrorBanner } from '../src/ui/ErrorBanner'
import { FadeInUp } from '../src/ui/FadeInUp'
import { Skeleton } from '../src/ui/Skeleton'
import { StackHeader } from '../src/ui/StackHeader'

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  MISSION_NOT_FOUND: 'Mission introuvable.',
  TIMEOUT: 'Le serveur met trop de temps à répondre — réessayez.',
  NETWORK_ERROR: 'Pas de connexion — réessayez.',
}

/**
 * S6 — « Mission terminée » (COMMISSAIRE_PRISEUR_PLAN.md §5.6, Lot 7). La
 * récompense premium : matérialise ce que l'IA a fait (compte-rendu sobre),
 * jamais de confettis criards. Ouvert après acceptation (S5) ou vente
 * zéro-clic ; aussi consultable depuis le tableau de bord S4 une fois vendu.
 */
export default function MissionRecapScreen() {
  const router = useRouter()
  const { missionId } = useLocalSearchParams<{ missionId: string }>()

  const fetchMission = useCallback(() => api.getMission(missionId), [missionId])
  const { data, loading, error, retry } = useApiResource(fetchMission)

  if (!missionId) return <Redirect href="/(tabs)" />

  const recap = data !== null ? missionRecap(data.mission, data.events) : undefined

  return (
    <View style={styles.screen}>
      <StackHeader title="Mission" onBack={() => router.replace('/(tabs)')} />

      {error !== null && data === null ? (
        <View style={styles.center}>
          <ErrorBanner message={ERROR_MESSAGES[error] ?? `Chargement impossible (${error}).`} onRetry={retry} />
        </View>
      ) : loading && data === null ? (
        <View style={styles.loading}>
          <Skeleton height={space[8]} round="lg" />
          <Skeleton height={space[7] + space[6]} round="lg" />
        </View>
      ) : recap === undefined || recap === null ? null : (
        <Recap recap={recap} onDone={() => router.replace('/(tabs)')} onSellAnother={() => router.replace('/(tabs)/vendre')} />
      )}
    </View>
  )
}

function Recap({
  recap,
  onDone,
  onSellAnother,
}: {
  recap: MissionRecap
  onDone: () => void
  onSellAnother: () => void
}) {
  if (recap.kind === 'STOPPED_NO_SALE') {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityLiveRegion="polite">
          Mission terminée
        </Text>
        <Text style={styles.subtitle}>Aucune vente conclue.</Text>
        <Button label="Fermer" variant="ghost" onPress={onDone} style={styles.doneButton} />
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <FadeInUp style={styles.celebration}>
        <PartyPopper size={space[7]} color={theme.bouteille} />
        <AmountText
          cents={recap.soldAmount ?? 0}
          size={font.display}
          color={theme.bouteille}
          style={styles.soldAmount}
        />
        <Text style={styles.soldLabel}>Vendu</Text>
      </FadeInUp>

      <Text style={styles.subtitle} accessibilityLiveRegion="polite">
        Votre commissaire-priseur IA a géré la vente pour vous.
      </Text>

      {recap.kind === 'SOLD_ZERO_CLICK' && (
        <Text style={styles.zeroClickNote}>L’IA a adjugé selon votre mandat.</Text>
      )}

      <Card style={styles.statsCard}>
        <StatRow
          icon={<MessageCircle size={space[4]} color={theme.goldDark} />}
          label={`${recap.messagesHandled} message${recap.messagesHandled > 1 ? 's' : ''} traité${recap.messagesHandled > 1 ? 's' : ''}`}
        />
        <StatRow
          icon={<PartyPopper size={space[4]} color={theme.goldDark} />}
          label={`${recap.offersNegotiated} offre${recap.offersNegotiated > 1 ? 's' : ''} négociée${recap.offersNegotiated > 1 ? 's' : ''}`}
        />
        {recap.durationLabel !== null && (
          <StatRow icon={<TrendingUp size={space[4]} color={theme.goldDark} />} label={`Vendu en ${recap.durationLabel}`} />
        )}
        {recap.deltaVsFirstOfferCents !== null && recap.deltaVsFirstOfferCents > 0 && (
          <StatRow
            icon={<TrendingUp size={space[4]} color={theme.goldDark} />}
            label={`+${(recap.deltaVsFirstOfferCents / 100).toFixed(2).replace('.', ',')} € vs première offre`}
          />
        )}
      </Card>

      <View style={styles.nextStep}>
        <Text style={styles.sectionLabel}>Prochaine étape</Text>
        <Text style={styles.nextStepText}>Finalisez l’envoi via la plateforme.</Text>
      </View>

      <Button label="Vendre un autre objet" variant="ghost" onPress={onSellAnother} icon={<Camera size={font.lead} color={theme.ink} />} />
    </ScrollView>
  )
}

function StatRow({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <View style={styles.statRow}>
      {icon}
      <Text style={styles.statText}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  center: { flex: 1, padding: space[5] },
  loading: { padding: space[5], gap: space[3] },

  content: { padding: space[5], gap: space[4], paddingBottom: space[7], alignItems: 'center' },

  celebration: { alignItems: 'center', gap: space[1] },
  soldAmount: { marginTop: space[2] },
  soldLabel: { fontSize: font.small, color: theme.muted },

  title: { fontSize: font.heading, lineHeight: line.heading, fontWeight: '700', color: theme.ink, textAlign: 'center' },
  subtitle: { fontSize: font.body, lineHeight: line.body, color: theme.muted, textAlign: 'center' },
  zeroClickNote: { fontSize: font.caption, color: theme.muted, textAlign: 'center' },

  statsCard: { width: '100%', gap: space[3] },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  statText: { fontSize: font.small, color: theme.ink },

  nextStep: { width: '100%', gap: space[1] },
  sectionLabel: { fontSize: font.caption, fontWeight: '700', color: theme.muted },
  nextStepText: { fontSize: font.small, color: theme.ink },

  doneButton: { marginTop: space[4] },
})
