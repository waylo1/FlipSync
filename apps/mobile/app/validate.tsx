import { useCallback, useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ItemCondition,
  ListingDraft,
  ListingTier,
  TIER_FEATURES,
  TIER_PRICING,
  centsToEur,
  eurToCents,
  isPriceFlagged,
} from '@flipsync/core'
import { api, ApiError } from '../src/services/api'
import { dev } from '../src/dev-session/recorder'
import {
  PUBLISH_STEP_RANK,
  PendingPublish,
  SessionPhoto,
  useListingSession,
  usePendingPublish,
} from '../src/store/listing.store'
import { ConditionChips } from '../src/components/ConditionChips'
import { PriceFlagAlert } from '../src/components/PriceFlagAlert'
import { font, formatEur, line, radius, space, theme, tracking } from '../src/theme'
import { Button } from '../src/ui/Button'
import { Field } from '../src/ui/Field'
import { ErrorBanner } from '../src/ui/ErrorBanner'

/** Messages utilisateur pour les codes d'erreur API les plus probables ici. */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  NO_AUTH_TOKEN: 'Session expirée — reconnectez-vous.',
  UNAUTHORIZED: 'Session expirée — reconnectez-vous.',
  INSUFFICIENT_FUNDS: 'Solde insuffisant — rechargez votre cagnotte.',
  NO_FREE_CREDIT: 'Plus d’annonce gratuite ce mois-ci — rechargez votre cagnotte.',
  INVALID_TRANSITION: 'Cette annonce a déjà été traitée.',
  TIMEOUT: 'Le serveur met trop de temps à répondre — rien n’est perdu, reprenez quand vous voulez.',
  NETWORK_ERROR: 'Pas de connexion — rien n’est perdu, reprenez quand vous voulez.',
}

export default function ValidateScreen() {
  const router = useRouter()
  const { draft, photos, tier, clearSession } = useListingSession()
  const pending = usePendingPublish(s => s.pending)

  // Reprise : sans session (restart), le brouillon persisté du pending fait foi.
  const effectiveDraft = draft ?? pending?.draft ?? null
  // Le palier a été choisi À LA CAPTURE (avant rédaction) — verrouillé ici.
  // Fallback OPTIMIZED : ne devrait survenir que sur un pending créé avant ce
  // changement (aucun tel cas en pratique, l'app n'est pas encore publiée).
  const effectiveTier = tier ?? pending?.tier ?? ListingTier.OPTIMIZED

  // Ni session ni publication interrompue → retour capture.
  if (!effectiveDraft) return <Redirect href="/(tabs)" />

  return (
    <ValidateForm
      draft={effectiveDraft}
      photos={photos}
      tier={effectiveTier}
      resume={pending}
      clearSession={clearSession}
      goHome={() => router.replace('/(tabs)')}
    />
  )
}

interface FormProps {
  draft: ListingDraft
  photos: readonly SessionPhoto[]
  /** Palier choisi à la capture — verrouillé, non modifiable ici. */
  tier: ListingTier
  /** Publication interrompue à reprendre — null pour une première tentative. */
  resume: PendingPublish | null
  clearSession: () => void
  goHome: () => void
}

/** INVALID_TRANSITION sur une étape intermédiaire = réponse perdue, étape déjà
 *  franchie côté serveur (le statut est serveur-autoritaire) → on continue. */
function ignoreAlreadyDone(err: unknown): void {
  if (err instanceof ApiError && err.code === 'INVALID_TRANSITION') return
  throw err
}

function ValidateForm({ draft, photos, tier, resume, clearSession, goHome }: FormProps) {
  // Champs éditables — pré-remplis par l'IA, l'utilisateur a le dernier mot.
  const [titre, setTitre] = useState(draft.titre)
  const [description, setDescription] = useState(draft.description)
  const [marque, setMarque] = useState(draft.marque ?? '')
  const [etat, setEtat] = useState<ItemCondition>(draft.etat)
  // Prix saisi en euros (affichage) — converti en centimes Int pour tout calcul.
  // En reprise : re-seed du prix saisi lors de l'essai interrompu.
  const [prixInput, setPrixInput] = useState(
    centsToEur(resume?.prixPublie ?? draft.prixHaut).toFixed(2),
  )

  const [publishing, setPublishing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  /** Centimes Int ou null si saisie invalide. */
  const prixPublie = useMemo(() => {
    const eur = Number(prixInput.replace(',', '.'))
    return Number.isFinite(eur) && eur >= 0 ? eurToCents(eur) : null
  }, [prixInput])

  // Règle de diplomatie — alerte live, non bloquante.
  const flagged = prixPublie !== null && isPriceFlagged(prixPublie, draft.prixHaut)

  const formValid = titre.trim().length > 0 && description.trim().length > 0 && prixPublie !== null

  /**
   * Publication = séquence machine à états, AUCUN débit avant validate :
   * POST /listing (authorize) → photos (sha256 vérifié) → ai-start →
   * draft (édité) → validate (commit).
   *
   * RÉSILIENCE : chaque étape franchie est persistée (usePendingPublish, MMKV).
   * Coupure au milieu → rien n'est perdu ni débité ; le bouton devient
   * « Reprendre » et la séquence repart de l'étape suivante (jamais de doublon :
   * createListing n'est PAS rejoué si un listingId existe).
   */
  const publish = useCallback(async () => {
    if (!formValid || prixPublie === null || publishing) return
    setPublishing(true)
    setErrorMessage(null)

    const { setPending, clearPending } = usePendingPublish.getState()

    try {
      const editedDraft: ListingDraft = {
        ...draft,
        titre: titre.trim(),
        description: description.trim(),
        marque: marque.trim() === '' ? null : marque.trim(),
        etat,
      }

      // Étape 0 — création (authorize, 0 débit). Jamais rejouée en reprise.
      let listingId: string
      let doneRank: number
      if (resume !== null) {
        listingId = resume.listingId
        doneRank = PUBLISH_STEP_RANK[resume.done]
      } else {
        const created = await api.createListing(tier)
        if (!created.auth.authorized) {
          const deficit = created.auth.deficit ?? 0
          setErrorMessage(
            `Solde insuffisant : il manque ${formatEur(deficit)}. ` +
              'Rechargez votre cagnotte — l’annonce repartira automatiquement.',
          )
          return
        }
        listingId = created.listing.id
        doneRank = PUBLISH_STEP_RANK.created
        setPending({ listingId, tier, draft: editedDraft, prixPublie, done: 'created' })
      }

      const checkpoint = (done: PendingPublish['done']) =>
        setPending({ listingId, tier, draft: editedDraft, prixPublie, done })

      // Étape 1 — photos (idempotent par sha256 ; absentes en reprise post-restart).
      if (doneRank < PUBLISH_STEP_RANK.photos && photos.length > 0) {
        await api.uploadPhotos(
          listingId,
          photos.map((p, order) => ({ base64: p.base64, sha256: p.sha256, order })),
        )
        checkpoint('photos')
      }

      // Étapes 2 & 3 — transitions serveur ; INVALID_TRANSITION = déjà franchie.
      if (doneRank < PUBLISH_STEP_RANK.ai) {
        await api.startAi(listingId).catch(ignoreAlreadyDone)
        checkpoint('ai')
      }
      if (doneRank < PUBLISH_STEP_RANK.draft) {
        await api.pushDraft(listingId, editedDraft).catch(ignoreAlreadyDone)
        checkpoint('draft')
      }

      // Étape finale — LE débit. Déjà traitée côté serveur → l'état fait foi.
      try {
        await api.validate(listingId, prixPublie)
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'INVALID_TRANSITION') throw err
      }

      clearPending()
      clearSession()
      dev.track('publish_success')
      goHome()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR'
      setErrorMessage(ERROR_MESSAGES[code] ?? `Publication échouée (${code}).`)
      dev.track('publish_failed')
    } finally {
      setPublishing(false)
    }
  }, [formValid, prixPublie, publishing, resume, draft, photos, titre, description, marque, etat, tier, clearSession, goHome])

  /**
   * Dernière vérification avant débit — l'utilisateur doit voir explicitement
   * ce qui se passe (règle produit) : la cagnotte est débitée maintenant, les
   * photos seront figées, mais titre/description/prix/état restent modifiables
   * et une annulation ultérieure rembourse intégralement (cf. écran « Mes annonces »).
   */
  const confirmPublish = useCallback(() => {
    dev.track(resume !== null ? 'retry_publish' : 'publish_button_pressed')
    Alert.alert(
      'Confirmer la publication ?',
      `${formatEur(TIER_PRICING[tier])} seront débités de votre cagnotte maintenant. Les photos ne pourront plus être changées, mais vous pourrez encore corriger le texte, le prix et l'état, ou annuler (remboursement intégral) depuis « Mes annonces ».`,
      [
        { text: 'Revoir', style: 'cancel' },
        { text: 'Confirmer', onPress: () => void publish() },
      ],
    )
  }, [tier, publish, resume])

  const insets = useSafeAreaInsets()

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space[4] }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Text accessibilityRole="header" style={styles.heading}>
        Vérifiez votre annonce
      </Text>
      <Text style={styles.subheading}>Modifiez ce que vous voulez avant de valider.</Text>

      <Field label="Titre" value={titre} onChangeText={setTitre} maxLength={120} showCount />

      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        style={styles.multiline}
      />

      <Field label="Marque" value={marque} onChangeText={setMarque} placeholder="Aucune" />

      <Text style={styles.label}>État</Text>
      <ConditionChips value={etat} onChange={setEtat} />

      <Field
        label="Prix de vente (€)"
        hint={`Estimation : ${formatEur(draft.prixPlancher)} — ${formatEur(draft.prixHaut)}`}
        value={prixInput}
        onChangeText={setPrixInput}
        keyboardType="decimal-pad"
        inputMode="decimal"
        error={prixPublie === null ? 'Prix invalide' : null}
      />
      {flagged && prixPublie !== null && (
        <PriceFlagAlert prixPublie={prixPublie} prixHaut={draft.prixHaut} />
      )}

      <Text style={styles.formuleInfo}>
        ℹ️ Formule {TIER_FEATURES[tier].label} · {formatEur(TIER_PRICING[tier])} · verrouillée à
        la capture
      </Text>

      {errorMessage && <ErrorBanner message={errorMessage} />}

      <Button
        label={
          resume !== null
            ? `Reprendre la publication — ${formatEur(TIER_PRICING[tier])}`
            : `Valider et publier — ${formatEur(TIER_PRICING[tier])}`
        }
        onPress={() => confirmPublish()}
        loading={publishing}
        disabled={!formValid}
        style={styles.publishBtn}
      />
      <Text style={styles.hint}>
        Le débit n'a lieu qu'à cette validation — rien n'est prélevé avant.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  // Rythme vertical hiérarchisé : 12 entre éléments, 16 avant chaque section (labels).
  // paddingTop fourni en inline (safe-area insets.top).
  content: { padding: space[5], gap: space[3], paddingBottom: space[7] },
  // Un seul H1 par écran — cran heading de l'échelle, jamais de taille dérivée.
  heading: {
    fontSize: font.heading,
    lineHeight: line.heading,
    fontWeight: '700',
    color: theme.ink,
    letterSpacing: tracking.heading,
  },
  subheading: {
    fontSize: font.small,
    lineHeight: line.small,
    color: theme.muted,
    marginBottom: space[3],
  },
  label: { fontSize: font.small, fontWeight: '600', marginTop: space[4], color: theme.ink },
  hint: { fontSize: font.caption, lineHeight: line.caption, color: theme.muted, textAlign: 'center' },
  multiline: { minHeight: space[8] + space[7], textAlignVertical: 'top' },

  // Info discrète plutôt qu'un bloc label+hint+liste de features : la formule
  // est verrouillée ici, elle ne mérite pas plus qu'une ligne de rappel.
  formuleInfo: {
    fontSize: font.caption,
    lineHeight: line.caption,
    color: theme.muted,
    marginTop: space[4],
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.md,
    padding: space[3],
  },

  publishBtn: { marginTop: space[5] },
})
