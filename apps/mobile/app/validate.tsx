import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import {
  ItemCondition,
  ListingDraft,
  ListingTier,
  TIER_PRICING,
  centsToEur,
  eurToCents,
  isPriceFlagged,
} from '@flipsync/core'
import { api, ApiError } from '../src/services/api'
import {
  PUBLISH_STEP_RANK,
  PendingPublish,
  SessionPhoto,
  useListingSession,
  usePendingPublish,
} from '../src/store/listing.store'
import { PriceFlagAlert } from '../src/components/PriceFlagAlert'
import { MIN_TOUCH, font, formatEur, radius, space, theme } from '../src/theme'
import { Button } from '../src/ui/Button'
import { Field } from '../src/ui/Field'
import { ErrorBanner } from '../src/ui/ErrorBanner'

const CONDITIONS: readonly { value: ItemCondition; label: string }[] = [
  { value: ItemCondition.neuf, label: 'Neuf' },
  { value: ItemCondition.tres_bon, label: 'Très bon' },
  { value: ItemCondition.bon, label: 'Bon' },
  { value: ItemCondition.correct, label: 'Correct' },
]

const TIERS: readonly { value: ListingTier; label: string }[] = [
  { value: ListingTier.SIMPLE, label: 'Simple' },
  { value: ListingTier.OPTIMIZED, label: 'Optimisée' },
  { value: ListingTier.PREMIUM, label: 'Premium' },
]

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
  const { draft, photos, clearSession } = useListingSession()
  const pending = usePendingPublish(s => s.pending)

  // Reprise : sans session (restart), le brouillon persisté du pending fait foi.
  const effectiveDraft = draft ?? pending?.draft ?? null

  // Ni session ni publication interrompue → retour capture.
  if (!effectiveDraft) return <Redirect href="/(tabs)" />

  return (
    <ValidateForm
      draft={effectiveDraft}
      photos={photos}
      resume={pending}
      clearSession={clearSession}
      goHome={() => router.replace('/(tabs)/listings')}
    />
  )
}

interface FormProps {
  draft: ListingDraft
  photos: readonly SessionPhoto[]
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

function ValidateForm({ draft, photos, resume, clearSession, goHome }: FormProps) {
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
  // Formule verrouillée en reprise : le coût du listing est figé à la création.
  const [tier, setTier] = useState<ListingTier>(resume?.tier ?? ListingTier.OPTIMIZED)

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
      goHome()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR'
      setErrorMessage(ERROR_MESSAGES[code] ?? `Publication échouée (${code}).`)
    } finally {
      setPublishing(false)
    }
  }, [formValid, prixPublie, publishing, resume, draft, photos, titre, description, marque, etat, tier, clearSession, goHome])

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>
        Vérifiez votre annonce
      </Text>
      <Text style={styles.subheading}>
        Rédigée sur votre téléphone — modifiez ce que vous voulez, rien n'est débité avant votre
        validation.
      </Text>

      <Field label="Titre" value={titre} onChangeText={setTitre} maxLength={120} />

      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        style={styles.multiline}
      />

      <Field label="Marque" value={marque} onChangeText={setMarque} placeholder="Aucune" />

      <Text style={styles.label}>État</Text>
      <View style={styles.chipRow} accessibilityRole="radiogroup">
        {CONDITIONS.map(c => {
          const active = etat === c.value
          return (
            <Pressable
              key={c.value}
              accessibilityRole="radio"
              accessibilityLabel={`État : ${c.label}`}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.chip,
                active && styles.chipActive,
                pressed && styles.pressed,
              ]}
              onPress={() => setEtat(c.value)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
            </Pressable>
          )
        })}
      </View>

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

      <Text style={styles.label}>Formule</Text>
      {resume !== null && (
        <Text style={styles.hint}>
          Formule verrouillée : l’annonce est déjà réservée avec cette formule.
        </Text>
      )}
      <View style={styles.chipRow} accessibilityRole="radiogroup">
        {TIERS.map(t => {
          const active = tier === t.value
          const locked = resume !== null
          return (
            <Pressable
              key={t.value}
              accessibilityRole="radio"
              accessibilityLabel={`Formule ${t.label}, ${formatEur(TIER_PRICING[t.value])}`}
              accessibilityState={{ selected: active, disabled: locked }}
              disabled={locked}
              style={({ pressed }) => [
                styles.tierCard,
                active && styles.chipActive,
                locked && !active && styles.tierLocked,
                pressed && styles.pressed,
              ]}
              onPress={() => setTier(t.value)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
              <Text style={[styles.tierPrice, active && styles.chipTextActive]}>
                {formatEur(TIER_PRICING[t.value])}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {errorMessage && <ErrorBanner message={errorMessage} />}

      <Button
        label={
          resume !== null
            ? `Reprendre la publication — ${formatEur(TIER_PRICING[tier])}`
            : `Valider et publier — ${formatEur(TIER_PRICING[tier])}`
        }
        onPress={() => void publish()}
        loading={publishing}
        disabled={!formValid}
        style={styles.publishBtn}
      />
      <Text style={styles.hint}>
        Le débit n'a lieu qu'à cette validation. Échec de publication = remboursement automatique.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  content: { padding: space[5], paddingTop: space[8], gap: space[2], paddingBottom: space[7] },
  heading: { fontSize: font.heading - space[1] / 2, fontWeight: '700', color: theme.ink },
  subheading: { fontSize: font.small, color: theme.muted, marginBottom: space[2] },
  label: { fontSize: font.small, fontWeight: '600', marginTop: space[3], color: theme.ink },
  hint: { fontSize: font.caption, color: theme.muted, textAlign: 'center' },
  multiline: { minHeight: space[8] + space[7], textAlignVertical: 'top' },

  chipRow: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.pill,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    backgroundColor: theme.card,
  },
  chipActive: { backgroundColor: theme.terracotta, borderColor: theme.terracotta },
  chipText: { fontSize: font.small, color: theme.ink },
  chipTextActive: { color: theme.onDark, fontWeight: '600' },
  pressed: { opacity: 0.85 },

  tierCard: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    alignItems: 'center',
    gap: space[1] / 2,
    minHeight: MIN_TOUCH,
    backgroundColor: theme.card,
  },
  tierPrice: { fontSize: font.caption, color: theme.muted },
  tierLocked: { opacity: 0.4 },

  publishBtn: { marginTop: space[4] },
})
