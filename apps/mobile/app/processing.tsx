import { useCallback, useEffect, useRef } from 'react'
import {
  Animated,
  Easing,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { AlertTriangle, Camera, Check, Sparkles } from 'lucide-react-native'
import { api } from '../src/services/api'
import {
  AnalysisJob,
  useAnalysisQueue,
  useListingSession,
  usePendingPublish,
} from '../src/store/listing.store'
import { font, line, motion, radius, shadow, space, theme } from '../src/theme'
import { Button } from '../src/ui/Button'
import { FadeInUp } from '../src/ui/FadeInUp'
import { StackHeader } from '../src/ui/StackHeader'

/** Messages humains pour les échecs de rédaction (jamais de code brut à l'écran). */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  NETWORK_ERROR: 'Serveur injoignable — vérifiez votre connexion, rien n’est débité.',
  TIMEOUT: 'La rédaction a pris trop de temps — réessayez.',
  NO_AUTH_TOKEN: 'Session expirée — reconnectez-vous.',
  NO_PHOTO: 'Aucune photo à analyser.',
  AI_JOB_STALE: 'La rédaction a expiré côté serveur (redémarrage pendant l’analyse) — réessayez.',
}
const ERROR_FALLBACK = 'La rédaction n’a pas abouti — rien n’est débité, réessayez.'

/**
 * Tableau de bord des rédactions en fond. On y arrive après « Rédiger » : les
 * analyses tournent ici pendant que l'utilisateur peut « enchaîner » (revenir à
 * la caméra) ou valider les brouillons prêts. Vide → retour accueil.
 */
export default function ProcessingScreen() {
  const router = useRouter()
  const jobs = useAnalysisQueue(s => s.jobs)

  if (jobs.length === 0) return <Redirect href="/(tabs)" />

  const running = jobs.filter(j => j.status === 'running')
  const ready = jobs.filter(j => j.status === 'ready')
  const failed = jobs.filter(j => j.status === 'failed')

  return (
    <View style={styles.screen}>
      <StackHeader title="Rédactions en cours" onBack={() => router.replace('/(tabs)')} />

      <ScrollView contentContainerStyle={styles.content}>
        {running.length > 0 && <RunningCard count={running.length} />}

        {/* Enchaîner : la caméra revient, les rédactions continuent en fond. */}
        <Button
          label="Enchaîner une nouvelle annonce"
          icon={<Camera size={font.lead} color={theme.onDark} />}
          onPress={() => router.replace('/(tabs)/vendre')}
        />

        {ready.map(job => (
          <ReadyCard key={job.id} job={job} />
        ))}

        {failed.map(job => (
          <FailedCard key={job.id} job={job} />
        ))}
      </ScrollView>
    </View>
  )
}

/** Carte « ça tourne » — point pulsant + barre de progression déterministe. */
function RunningCard({ count }: { count: number }) {
  const pulse = useRef(new Animated.Value(0)).current
  const progress = useRef(new Animated.Value(0.05)).current

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: motion.dur.slow * 2,
          easing: motion.ease.standard,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: motion.dur.slow * 2,
          easing: motion.ease.standard,
          useNativeDriver: true,
        }),
      ]),
    )
    pulseLoop.start()

    // Barre : 5% → 95% en ~90 s, courbe ease-out (rapide au début, puis lent).
    // useNativeDriver: false car on anime width (layout), pas transform.
    const progressAnim = Animated.timing(progress, {
      toValue: 0.95,
      duration: 90_000,
      easing: motion.ease.accelerate,
      useNativeDriver: false,
    })
    progressAnim.start()

    return () => {
      pulseLoop.stop()
      progressAnim.stop()
    }
  }, [pulse, progress])

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] })
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.12] })
  const progressWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['5%', '95%'] })

  return (
    <View style={styles.runningCard} accessibilityLiveRegion="polite">
      <View style={styles.pulseWrap}>
        <Animated.View style={[styles.pulseHalo, { opacity, transform: [{ scale }] }]} />
        <View style={styles.pulseCore}>
          <Sparkles size={space[5]} color={theme.onDark} />
        </View>
      </View>
      <Text style={styles.runningTitle}>
        {count > 1
          ? `FlipSync rédige ${count} annonces…`
          : 'FlipSync rédige votre annonce…'}
      </Text>
      <Text style={styles.runningBody}>
        Comptez 1 à 3 minutes par objet selon la formule (plus de photos analysées
        = plus long). Vous pouvez fermer l'app ou photographier le suivant pendant
        ce temps — la rédaction continue sur nos serveurs.
      </Text>

      {/* Barre de progression déterministe — simule l'avancement (5% → 95%). */}
      <View style={styles.progressBar}>
        <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
      </View>
    </View>
  )
}

/** Carte d'un brouillon prêt à valider. */
function ReadyCard({ job }: { job: AnalysisJob }) {
  const router = useRouter()

  const open = useCallback(() => {
    if (!job.draft) return
    // Nouvel objet à valider = une publication interrompue d'un AUTRE objet
    // deviendrait un mélange annonce/photos. On l'abandonne (cancel serveur
    // gratuit, pré-commit) avant d'ouvrir la validation de celui-ci.
    const stale = usePendingPublish.getState().pending
    if (stale) {
      usePendingPublish.getState().clearPending()
      api.cancel(stale.listingId).catch(() => {
        // Déjà annulée/validée côté serveur — rien à rattraper.
      })
    }
    useListingSession.getState().setSession(job.draft, job.photos, job.tier)
    useAnalysisQueue.getState().remove(job.id)
    router.push('/validate')
  }, [job, router])

  return (
    <FadeInUp>
      <View style={[styles.card, styles.cardReady]}>
        <Image source={{ uri: job.coverUri }} style={styles.cover} accessibilityIgnoresInvertColors />
        <View style={styles.cardBody}>
          <View style={styles.readyBadge}>
            <Check size={font.small} color={theme.onDark} />
            <Text style={styles.readyBadgeText}>Prête</Text>
          </View>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {job.draft?.titre ?? 'Annonce rédigée'}
          </Text>
          <Button label="Vérifier & publier" onPress={open} style={styles.cardBtn} />
        </View>
      </View>
    </FadeInUp>
  )
}

/** Carte d'une rédaction échouée — réessayer ou retirer. */
function FailedCard({ job }: { job: AnalysisJob }) {
  const retry = useAnalysisQueue(s => s.retry)
  const remove = useAnalysisQueue(s => s.remove)

  return (
    <FadeInUp>
      <View style={[styles.card, styles.cardFailed]}>
        <Image source={{ uri: job.coverUri }} style={styles.cover} accessibilityIgnoresInvertColors />
        <View style={styles.cardBody}>
          <View style={styles.failedRow}>
            <AlertTriangle size={font.small} color={theme.brique} />
            <Text style={styles.failedText}>
              {ERROR_MESSAGES[job.errorCode ?? ''] ?? ERROR_FALLBACK}
            </Text>
          </View>
          <View style={styles.failedActions}>
            <Button label="Réessayer" onPress={() => retry(job.id)} style={styles.cardBtn} />
            <Button
              label="Retirer"
              variant="ghost"
              onPress={() => remove(job.id)}
              style={styles.cardBtn}
            />
          </View>
        </View>
      </View>
    </FadeInUp>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },

  content: { padding: space[5], paddingTop: space[3], gap: space[4] },

  runningCard: {
    backgroundColor: theme.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: space[5],
    alignItems: 'center',
    gap: space[3],
    ...shadow.card,
  },
  pulseWrap: { width: space[8], height: space[8], alignItems: 'center', justifyContent: 'center' },
  pulseHalo: {
    position: 'absolute',
    width: space[8],
    height: space[8],
    borderRadius: radius.pill,
    backgroundColor: theme.faience,
  },
  pulseCore: {
    width: space[7],
    height: space[7],
    borderRadius: radius.pill,
    backgroundColor: theme.faience,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runningTitle: {
    fontSize: font.title,
    lineHeight: line.title,
    fontWeight: '700',
    color: theme.ink,
    textAlign: 'center',
  },
  runningBody: {
    fontSize: font.small,
    lineHeight: line.small,
    color: theme.muted,
    textAlign: 'center',
  },

  progressBar: {
    width: '100%',
    height: space[1],
    borderRadius: radius.xs,
    backgroundColor: theme.onDarkTrack,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.gold,
    borderRadius: radius.xs,
  },

  card: {
    flexDirection: 'row',
    backgroundColor: theme.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    ...shadow.surface,
  },
  cardReady: { borderColor: theme.bouteille },
  cardFailed: { borderColor: theme.briqueSoft },
  cover: { width: space[8] + space[5], height: '100%', backgroundColor: theme.kraft },
  cardBody: { flex: 1, padding: space[3], gap: space[2], justifyContent: 'center' },
  cardTitle: { fontSize: font.body, lineHeight: line.body, fontWeight: '600', color: theme.ink },
  cardBtn: { flex: 1 },

  readyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space[1],
    backgroundColor: theme.bouteille,
    borderRadius: radius.pill,
    paddingHorizontal: space[2],
    paddingVertical: space[1] / 2,
  },
  readyBadgeText: { fontSize: font.caption, fontWeight: '700', color: theme.onDark },

  failedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  failedText: { flex: 1, fontSize: font.small, lineHeight: line.small, fontWeight: '600', color: theme.brique },
  failedActions: { flexDirection: 'row', gap: space[2] },
})
