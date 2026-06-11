import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
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
import { useListingSession, SessionPhoto } from '../src/store/listing.store'
import { PriceFlagAlert } from '../src/components/PriceFlagAlert'

const CONDITIONS: readonly { value: ItemCondition; label: string }[] = [
  { value: ItemCondition.neuf, label: 'Neuf' },
  { value: ItemCondition.tres_bon, label: 'Très bon' },
  { value: ItemCondition.bon, label: 'Bon' },
  { value: ItemCondition.correct, label: 'Correct' },
]

const TIERS: readonly { value: ListingTier; label: string }[] = [
  { value: ListingTier.SIMPLE, label: 'Simple' },
  { value: ListingTier.OPTIMIZED, label: 'Optimisé' },
  { value: ListingTier.PREMIUM, label: 'Premium' },
]

/** Messages utilisateur pour les codes d'erreur API les plus probables ici. */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  NO_AUTH_TOKEN: 'Session expirée — reconnectez-vous.',
  INSUFFICIENT_FUNDS: 'Solde insuffisant — rechargez votre wallet.',
  NO_FREE_CREDIT: 'Plus de listing gratuit ce mois-ci — rechargez votre wallet.',
  INVALID_TRANSITION: 'Ce listing a déjà été traité.',
}

export default function ValidateScreen() {
  const router = useRouter()
  const { draft, photos, clearSession } = useListingSession()

  // Session perdue (reload, accès direct) → retour capture.
  if (!draft) return <Redirect href="/(tabs)" />

  return (
    <ValidateForm
      draft={draft}
      photos={photos}
      clearSession={clearSession}
      goHome={() => router.replace('/(tabs)/listings')}
    />
  )
}

interface FormProps {
  draft: ListingDraft
  photos: readonly SessionPhoto[]
  clearSession: () => void
  goHome: () => void
}

function ValidateForm({ draft, photos, clearSession, goHome }: FormProps) {
  // Champs éditables — pré-remplis par l'IA, l'utilisateur a le dernier mot.
  const [titre, setTitre] = useState(draft.titre)
  const [description, setDescription] = useState(draft.description)
  const [marque, setMarque] = useState(draft.marque ?? '')
  const [etat, setEtat] = useState<ItemCondition>(draft.etat)
  // Prix saisi en euros (affichage) — converti en centimes Int pour tout calcul.
  const [prixInput, setPrixInput] = useState(centsToEur(draft.prixHaut).toFixed(2))
  const [tier, setTier] = useState<ListingTier>(ListingTier.OPTIMIZED)

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
   */
  const publish = useCallback(async () => {
    if (!formValid || prixPublie === null || publishing) return
    setPublishing(true)
    setErrorMessage(null)

    try {
      const editedDraft: ListingDraft = {
        ...draft,
        titre: titre.trim(),
        description: description.trim(),
        marque: marque.trim() === '' ? null : marque.trim(),
        etat,
      }

      const created = await api.createListing(tier)
      if (!created.auth.authorized) {
        const deficit = created.auth.deficit ?? 0
        setErrorMessage(
          `Solde insuffisant : il manque ${centsToEur(deficit).toFixed(2)} €. ` +
            'Rechargez votre wallet — le listing sera automatiquement réautorisé.',
        )
        return
      }

      const id = created.listing.id
      if (photos.length > 0) {
        await api.uploadPhotos(
          id,
          photos.map((p, order) => ({ base64: p.base64, sha256: p.sha256, order })),
        )
      }
      await api.startAi(id)
      await api.pushDraft(id, editedDraft)
      await api.validate(id, prixPublie)

      clearSession()
      goHome()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR'
      setErrorMessage(ERROR_MESSAGES[code] ?? `Publication échouée (${code}).`)
    } finally {
      setPublishing(false)
    }
  }, [formValid, prixPublie, publishing, draft, photos, titre, description, marque, etat, tier, clearSession, goHome])

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Vérifiez votre annonce</Text>
      <Text style={styles.subheading}>
        Générée par l'IA locale — modifiez ce que vous voulez, rien n'est débité avant votre
        validation.
      </Text>

      <Text style={styles.label}>Titre</Text>
      <TextInput style={styles.input} value={titre} onChangeText={setTitre} maxLength={120} />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <Text style={styles.label}>Marque</Text>
      <TextInput
        style={styles.input}
        value={marque}
        onChangeText={setMarque}
        placeholder="Aucune"
      />

      <Text style={styles.label}>État</Text>
      <View style={styles.chipRow}>
        {CONDITIONS.map(c => (
          <Pressable
            key={c.value}
            style={[styles.chip, etat === c.value && styles.chipActive]}
            onPress={() => setEtat(c.value)}
          >
            <Text style={[styles.chipText, etat === c.value && styles.chipTextActive]}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Prix de vente (€)</Text>
      <Text style={styles.hint}>
        Estimation IA : {centsToEur(draft.prixPlancher).toFixed(2)} € —{' '}
        {centsToEur(draft.prixHaut).toFixed(2)} €
      </Text>
      <TextInput
        style={[styles.input, prixPublie === null && styles.inputError]}
        value={prixInput}
        onChangeText={setPrixInput}
        keyboardType="decimal-pad"
        inputMode="decimal"
      />
      {flagged && prixPublie !== null && (
        <PriceFlagAlert prixPublie={prixPublie} prixHaut={draft.prixHaut} />
      )}

      <Text style={styles.label}>Formule</Text>
      <View style={styles.chipRow}>
        {TIERS.map(t => (
          <Pressable
            key={t.value}
            style={[styles.tierCard, tier === t.value && styles.chipActive]}
            onPress={() => setTier(t.value)}
          >
            <Text style={[styles.chipText, tier === t.value && styles.chipTextActive]}>
              {t.label}
            </Text>
            <Text style={[styles.tierPrice, tier === t.value && styles.chipTextActive]}>
              {centsToEur(TIER_PRICING[t.value]).toFixed(2)} €
            </Text>
          </Pressable>
        ))}
      </View>

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      <Pressable
        style={[styles.publishBtn, (!formValid || publishing) && styles.disabled]}
        onPress={() => void publish()}
        disabled={!formValid || publishing}
      >
        {publishing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.publishText}>
            Valider et publier — {centsToEur(TIER_PRICING[tier]).toFixed(2)} €
          </Text>
        )}
      </Pressable>
      <Text style={styles.hint}>
        Le débit n'a lieu qu'à cette validation. Échec de publication = remboursement automatique.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingTop: 64, gap: 8, paddingBottom: 48 },
  heading: { fontSize: 24, fontWeight: '700' },
  subheading: { fontSize: 13, opacity: 0.6, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 12 },
  hint: { fontSize: 12, opacity: 0.6 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
  },
  inputError: { borderColor: '#dc2626' },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  chipText: { fontSize: 13, color: '#111' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  tierCard: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2,
  },
  tierPrice: { fontSize: 12, opacity: 0.7 },
  error: { color: '#dc2626', marginTop: 8 },
  publishBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  publishText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.4 },
})
