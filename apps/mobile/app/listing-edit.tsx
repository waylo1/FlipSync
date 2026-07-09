import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { ItemCondition, centsToEur, eurToCents, isPriceFlagged } from '@flipsync/core'
import { ApiError, ApiListing, api } from '../src/services/api'
import { PriceFlagAlert } from '../src/components/PriceFlagAlert'
import { MIN_TOUCH, font, formatEur, line, radius, space, theme } from '../src/theme'
import { Button } from '../src/ui/Button'
import { Field } from '../src/ui/Field'
import { ErrorBanner } from '../src/ui/ErrorBanner'
import { Skeleton } from '../src/ui/Skeleton'
import { StackHeader } from '../src/ui/StackHeader'

const CONDITIONS: readonly { value: ItemCondition; label: string }[] = [
  { value: ItemCondition.neuf, label: 'Neuf' },
  { value: ItemCondition.tres_bon, label: 'Très bon' },
  { value: ItemCondition.bon, label: 'Bon' },
  { value: ItemCondition.correct, label: 'Correct' },
]

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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.hint}>
        Les photos ne sont plus modifiables une fois l'annonce validée. Vos autres corrections sont
        gratuites.
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

      <Button
        label="Annuler l'annonce"
        variant="danger"
        onPress={confirmCancel}
        loading={cancelling}
        disabled={saving}
        style={styles.cancelBtn}
      />
      <Text style={styles.hint}>
        {listing.prixPublie !== null ? formatEur(listing.cost) : ''} seront remboursés sur votre
        cagnotte si vous annulez.
      </Text>
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
  pressed: { opacity: 0.7 },

  saveBtn: { marginTop: space[5] },
  cancelBtn: { marginTop: space[2] },
})
