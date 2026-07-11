import { useCallback } from 'react'
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronRight, EllipsisVertical, MessageCircle, ShieldAlert, Sparkles } from 'lucide-react-native'
import { MissionStatus, centsToEur } from '@flipsync/core'
import { ApiError, ApiMission, ApiMissionEvent, api } from '../src/services/api'
import { useApiResource } from '../src/hooks/useApiResource'
import { BandeauTone, isDashboardCalm, missionBandeau, pendingValidationSummary } from '../src/lib/mission-dashboard'
import { formatRelativeFr } from '../src/lib/time'
import { font, line, radius, space, theme } from '../src/theme'
import { Card } from '../src/ui/Card'
import { EmptyState } from '../src/ui/EmptyState'
import { ErrorBanner } from '../src/ui/ErrorBanner'
import { FadeInUp } from '../src/ui/FadeInUp'
import { Skeleton } from '../src/ui/Skeleton'
import { StackHeader } from '../src/ui/StackHeader'

const TONE_STYLES: Readonly<Record<BandeauTone, { bg: string; fg: string }>> = {
  faience: { bg: theme.faienceSoft, fg: theme.faience },
  moutarde: { bg: theme.moutardeSoft, fg: theme.moutarde },
  bouteille: { bg: theme.bouteilleSoft, fg: theme.bouteille },
  muted: { bg: theme.kraft, fg: theme.muted },
}

const OBJECTIVE_LABELS: Readonly<Record<string, string>> = {
  VENDRE_VITE: 'Vendre vite',
  EQUILIBRE: 'Équilibre',
  MEILLEUR_PRIX: 'Meilleur prix',
}

/** États depuis lesquels le menu ⋯ propose « Suspendre ». */
const SUSPENDABLE: readonly MissionStatus[] = [
  MissionStatus.EN_VENTE,
  MissionStatus.NEGOCIATION_ACTIVE,
  MissionStatus.EN_ATTENTE_VALIDATION,
]

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  MISSION_NOT_FOUND: 'Mission introuvable.',
  TIMEOUT: 'Le serveur met trop de temps à répondre — réessayez.',
  NETWORK_ERROR: 'Pas de connexion — réessayez.',
}

/**
 * S4 — Tableau de bord « Mission » (COMMISSAIRE_PRISEUR_PLAN.md §5.4, Lot 5).
 * Remplace listing-view pour une annonce Premium en mission. Bandeau d'état +
 * section « en attente de vous » (si applicable) + timeline, alimentés par le
 * canal simulé (Lot 4). Calme par défaut : aucune section moutarde tant que
 * rien ne requiert le vendeur.
 */
export default function MissionScreen() {
  const router = useRouter()
  const { listingId } = useLocalSearchParams<{ listingId: string }>()

  const fetchDashboard = useCallback(() => api.getMissionByListing(listingId), [listingId])
  const { data, loading, refreshing, error, retry, refresh } = useApiResource(fetchDashboard)

  if (!listingId) return <Redirect href="/(tabs)" />

  const menu = () => {
    if (!data) return
    const { mission } = data
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = []

    if (SUSPENDABLE.includes(mission.status)) {
      options.push({ text: 'Suspendre la mission', onPress: () => void act(() => api.suspendMission(mission.id)) })
    } else if (mission.status === MissionStatus.SUSPENDUE) {
      options.push({ text: 'Reprendre la mission', onPress: () => void act(() => api.resumeMission(mission.id)) })
    }
    if (SUSPENDABLE.includes(mission.status) || mission.status === MissionStatus.SUSPENDUE) {
      options.push({
        text: 'Arrêter la mission',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            'Arrêter la mission ?',
            'L’IA cesse de répondre. L’annonce reste en ligne, la vente redevient manuelle. Cette action est irréversible.',
            [
              { text: 'Garder la mission', style: 'cancel' },
              { text: 'Arrêter', style: 'destructive', onPress: () => void act(() => api.stopMission(mission.id)) },
            ],
          ),
      })
    }
    if (options.length === 0) return
    options.push({ text: 'Fermer', style: 'cancel' })
    Alert.alert('Mission', undefined, options)
  }

  const act = async (call: () => Promise<{ mission: ApiMission }>) => {
    try {
      await call()
      await refresh()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN'
      Alert.alert('Action impossible', ERROR_MESSAGES[code] ?? `Réessayez (${code}).`)
    }
  }

  return (
    <View style={styles.screen}>
      <StackHeader
        title="Mission"
        right={
          data ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Options de la mission"
              onPress={menu}
              hitSlop={space[2]}
              style={styles.menuButton}
            >
              <EllipsisVertical size={space[5]} color={theme.ink} />
            </Pressable>
          ) : null
        }
      />

      {error !== null && data === null ? (
        <View style={styles.center}>
          <ErrorBanner message={ERROR_MESSAGES[error] ?? `Chargement impossible (${error}).`} onRetry={retry} />
        </View>
      ) : loading && data === null ? (
        <View style={styles.loading}>
          <Skeleton height={space[8] + space[4]} round="md" />
          <Skeleton height={space[6]} round="sm" />
          <Skeleton height={space[6]} round="sm" />
        </View>
      ) : data === null ? null : (
        <Dashboard
          mission={data.mission}
          events={data.events}
          refreshing={refreshing}
          onRefresh={refresh}
          error={error}
          onRetry={retry}
          onOpenValidation={() => router.push({ pathname: '/mission-validate', params: { missionId: data.mission.id } })}
          onOpenRecap={() => router.push({ pathname: '/mission-recap', params: { missionId: data.mission.id } })}
        />
      )}
    </View>
  )
}

/** Statuts avec un compte-rendu S6 consultable (§5.6) — bandeau tappable. */
const RECAP_STATUSES: readonly MissionStatus[] = [
  MissionStatus.VENDU,
  MissionStatus.MISSION_TERMINEE,
  MissionStatus.ARRETEE,
]

function Dashboard({
  mission,
  events,
  refreshing,
  onRefresh,
  error,
  onRetry,
  onOpenValidation,
  onOpenRecap,
}: {
  mission: ApiMission
  events: ApiMissionEvent[]
  refreshing: boolean
  onRefresh: () => Promise<void>
  error: string | null
  onRetry: () => void
  onOpenValidation: () => void
  onOpenRecap: () => void
}) {
  const bandeau = missionBandeau(mission)
  const tone = TONE_STYLES[bandeau.tone]
  const pending = pendingValidationSummary(mission)
  const calm = isDashboardCalm(mission, events.length)
  const hasRecap = RECAP_STATUSES.includes(mission.status)

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      {error !== null && (
        <ErrorBanner message="Mise à jour impossible — réessai automatique." onRetry={onRetry} />
      )}

      <FadeInUp>
        <Pressable
          disabled={!hasRecap}
          accessibilityRole={hasRecap ? 'button' : undefined}
          accessibilityLabel={hasRecap ? `${bandeau.title} — voir le compte-rendu` : undefined}
          accessibilityLiveRegion="polite"
          onPress={onOpenRecap}
          style={[styles.bandeau, { backgroundColor: tone.bg }]}
        >
          <Text style={[styles.bandeauTitle, { color: tone.fg }]}>{bandeau.title}</Text>
          {bandeau.subtitle !== null && (
            <Text style={[styles.bandeauSubtitle, { color: tone.fg }]}>{bandeau.subtitle}</Text>
          )}
        </Pressable>
      </FadeInUp>

      {pending !== null && (
        <FadeInUp>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Validation requise : ${pending}`}
            onPress={onOpenValidation}
            style={styles.pendingCard}
          >
            <ShieldAlert size={space[5]} color={theme.moutarde} />
            <View style={styles.pendingBody}>
              <Text style={styles.pendingText}>{pending}</Text>
              <Text style={styles.pendingLink}>Répondre</Text>
            </View>
            <ChevronRight size={space[5]} color={theme.moutarde} />
          </Pressable>
        </FadeInUp>
      )}

      {calm ? (
        <EmptyState
          icon={<Sparkles size={space[6]} color={theme.goldDark} />}
          title="L’IA veille"
          body="Dès qu’un acheteur se manifeste, ça apparaît ici."
        />
      ) : (
        <View style={styles.timeline}>
          <Text style={styles.sectionLabel}>Activité</Text>
          {events.map(event => (
            <TimelineRow key={event.id} event={event} />
          ))}
        </View>
      )}

      <Card style={styles.mandateCard}>
        <Text style={styles.mandateLabel}>
          Objectif {OBJECTIVE_LABELS[mission.objectif] ?? mission.objectif} · mini{' '}
          {centsToEur(mission.prixMini).toFixed(2).replace('.', ',')} €
        </Text>
      </Card>
    </ScrollView>
  )
}

function TimelineRow({ event }: { event: ApiMissionEvent }) {
  const label = `${event.summary}, il y a ${formatRelativeFr(event.createdAt) || 'un instant'}`
  return (
    <View accessibilityLabel={label} style={styles.timelineRow}>
      <MessageCircle size={space[4]} color={theme.goldDark} />
      <Text style={styles.timelineText}>{event.summary}</Text>
      <Text style={styles.timelineTime}>{formatRelativeFr(event.createdAt)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  center: { flex: 1, padding: space[5] },
  loading: { padding: space[5], gap: space[3] },
  content: { padding: space[5], gap: space[4], paddingBottom: space[7] },

  menuButton: { minWidth: space[6], minHeight: space[6], alignItems: 'flex-end', justifyContent: 'center' },

  bandeau: { borderRadius: radius.lg, padding: space[4], gap: space[1] },
  bandeauTitle: { fontSize: font.lead, lineHeight: line.lead, fontWeight: '700' },
  bandeauSubtitle: { fontSize: font.small, lineHeight: line.small },

  pendingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: theme.moutardeSoft,
    borderColor: theme.moutardeBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[3],
  },
  pendingBody: { flex: 1, gap: space[1] / 2 },
  pendingText: { fontSize: font.small, fontWeight: '700', color: theme.moutarde },
  pendingLink: { fontSize: font.caption, fontWeight: '600', color: theme.moutarde },

  timeline: { gap: space[2] },
  sectionLabel: { fontSize: font.caption, fontWeight: '700', color: theme.muted },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  timelineText: { flex: 1, fontSize: font.small, lineHeight: line.small, color: theme.ink },
  timelineTime: { fontSize: font.caption, color: theme.muted },

  mandateCard: { marginTop: space[2] },
  mandateLabel: { fontSize: font.caption, color: theme.muted },
})
