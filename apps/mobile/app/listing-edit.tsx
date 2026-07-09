import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { ItemCondition, centsToEur, eurToCents, isPriceFlagged } from '@flipsync/core'
import { ApiError, ApiListing, api } from '../src/services/api'
import { ConditionChips } from '../src/components/ConditionChips'
import { PriceFlagAlert } from '../src/components/PriceFlagAlert'
import { font, formatEur, line, space, theme } from '../src/theme'
import { Button } from '../src/ui/Button'
import { Field } from '../src/ui/Field'
import { ErrorBanner } from '../src/ui/ErrorBanner'
import { Skeleton } from '../src/ui/Skeleton'
import { StackHeader } from '../src/ui/StackHeader'

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  LISTING_NOT_EDITABLE: 'Cette annonce ne peut plus être modifiée.',
  LISTING_NOT_FOUND: 'Annonce introuvable.',
  TIMEOUT: 'Le serveur met trop de temps à répondre — réessayez.',
  NETWORK_ERROR: 'Pas de connexion — réessayez.',
}

export default function ListingEditScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [listing, setListing] = useState<ApiListing | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!id) return
    setLoadError(null)
    api
      .getListing(id)
      .then(({ listing: l }) => setListing(l))
      .catch(err => setLoadError(err instanceof ApiError ? err.code : 'UNKNOWN'))
  }, [id])

  useEffect(() => load(), [load])

  if (!id) return <Redirect href="/(tabs)" />

  return (
    <View style={styles.screen}>
      <StackHeader title="Modifier l'annonce" />

      {loadError !== null ? (
        <View style={styles.center}>
          <ErrorBanner
            message={ERROR_MESSAGES[loadError] ?? `Chargement impossible (${loadError}).`}
            onRetry={load}
          />
        </View>
      ) : listing === null ? (
        <View style={styles.loading}>
          <Skeleton height={space[8]} />
          <Skeleton height={space[8] + space[7]} />
          <Skeleton height={space[6]} />
        </View>
      ) : (
        <EditForm listing={listing} goBack={() => router.back()} />
      )}
    </View>
  )
}

function EditForm({ listing, goBack }: { listing: ApiListing; goBack: () => void }) {
  const [titre, setTitre] = useState(listing.titre ?? '')
  const [description, setDescription] = useState(listing.description ?? '')
  const [marque, setMarque] = useState(listing.marque ?? '')
  const [etat, setEtat] = useState<ItemCondition | null>(listing.etat)
  const [prixInput, setPrixInput] = useState(
    listing.prixPublie !== null ? centsToEur(listing.prixPublie).toFixed(2) : '',
  )

  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const prixPublie = useMemo(() => {
    const eur = Number(prixInput.replace(',', '.'))
    return Number.isFinite(eur) && eur >= 0 ? eurToCents(eur) : null
  }, [prixInput])

  const flagged =
    prixPublie !== null && listing.prixHaut !== null && isPriceFlagged(prixPublie, listing.prixHaut)

  const formValid = titre.trim().length > 0 && description.trim().length > 0 && prixPublie !== null

  const save = useCallback(async () => {
    if (!formValid || prixPublie === null || saving) return
    setSaving(true)
    setErrorMessage(null)
    try {
      await api.editListing(listing.id, {
        titre: titre.trim(),
        description: description.trim(),
        marque: marque.trim() === '' ? null : marque.trim(),
        etat: etat ?? undefined,
        prixPublie,
      })
      goBack()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN'
      setErrorMessage(ERROR_MESSAGES[code] ?? `Enregistrement échoué (${code}).`)
    } finally {
      setSaving(false)
    }
  }, [formValid, prixPublie, saving, listing.id, titre, description, marque, etat, goBack])

  const confirmCancel = useCallback(() => {
    Alert.alert(
      'Annuler cette annonce ?',
      'Elle sera retirée définitivement et votre cagnotte remboursée intégralement. Cette action est irréversible.',
      [
        { text: 'Garder l’annonce', style: 'cancel' },
        {
          text: 'Annuler et rembourser',
          style: 'destructive',
          onPress: () => void doCancel(),
        },
      ],
    )
  }, [])

  const doCancel = useCallback(async () => {
    setCancelling(true)
    setErrorMessage(null)
    try {
      await api.cancel(listing.id)
      goBack()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN'
      setErrorMessage(ERROR_MESSAGES[code] ?? `Annulation échouée (${code}).`)
    } finally {
      setCancelling(false)
    }
  }, [listing.id, goBack])

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Text style={styles.hint}>ℹ️ Photos verrouillées après validation. · Corrections gratuites.</Text>

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
        value={prixInput}
        onChangeText={setPrixInput}
        keyboardType="decimal-pad"
        inputMode="decimal"
        error={prixPublie === null ? 'Prix invalide' : null}
      />
      {flagged && prixPublie !== null && listing.prixHaut !== null && (
        <PriceFlagAlert prixPublie={prixPublie} prixHaut={listing.prixHaut} />
      )}

      {errorMessage && <ErrorBanner message={errorMessage} />}

      <Button
        label="Enregistrer"
        onPress={() => void save()}
        loading={saving}
        disabled={!formValid || cancelling}
        style={styles.saveBtn}
      />

      {/* Séparée du CTA principal — action destructive, jamais au même poids
          visuel qu'Enregistrer. */}
      <View style={styles.dangerZone}>
        <View style={styles.divider} />
        <Button
          label="Annuler l'annonce"
          variant="danger"
          onPress={confirmCancel}
          loading={cancelling}
          disabled={saving}
        />
        {listing.prixPublie !== null && (
          <Text style={styles.hint}>
            {formatEur(listing.cost)} seront remboursés sur votre cagnotte si vous annulez.
          </Text>
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },

  center: { flex: 1, padding: space[5] },
  loading: { padding: space[5], gap: space[3] },

  content: { padding: space[5], gap: space[3], paddingBottom: space[7] },
  hint: { fontSize: font.caption, lineHeight: line.caption, color: theme.muted },
  label: { fontSize: font.small, fontWeight: '600', marginTop: space[4], color: theme.ink },
  multiline: { minHeight: space[8] + space[7], textAlignVertical: 'top' },

  saveBtn: { marginTop: space[5] },

  // Zone destructive nettement détachée du flux principal (Enregistrer) —
  // jamais la même urgence visuelle qu'une action courante.
  dangerZone: { marginTop: space[7], gap: space[3] },
  divider: { height: 1, backgroundColor: theme.border },
})
