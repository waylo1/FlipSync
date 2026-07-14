import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, useLocalSearchParams } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { Check, Copy, ExternalLink } from 'lucide-react-native'
import { ApiError, ApiListing, api } from '../src/services/api'
import { font, formatEur, line, space, theme } from '../src/theme'
import { Button } from '../src/ui/Button'
import { Card } from '../src/ui/Card'
import { ErrorBanner } from '../src/ui/ErrorBanner'
import { Skeleton } from '../src/ui/Skeleton'
import { StackHeader } from '../src/ui/StackHeader'

// ─── Tracking — seam locale (décision Run 5) ─────────────────────────────────
// Aucun pipeline analytics mobile aujourd'hui : log en dev, no-op en prod.
// Point de branchement UNIQUE le jour où un vrai collecteur existe.
type TrackEvent = 'cross_post_opened'
const track = (event: TrackEvent, props: Readonly<Record<string, string>>): void => {
  if (__DEV__) console.log(`[track] ${event}`, props)
}

/**
 * Mapping PRÉSENTATIONNEL uniquement (deep link + fallback web) — exception
 * CC-7 : aucune logique métier par canal côté mobile. Le kit couvre les deux
 * plateformes de la diffusion manuelle (Vinted, Leboncoin).
 */
const PLATFORMS = [
  { id: 'VINTED', label: 'Vinted', scheme: 'vinted://', web: 'https://www.vinted.fr' },
  { id: 'LEBONCOIN', label: 'Leboncoin', scheme: 'leboncoin://', web: 'https://www.leboncoin.fr' },
] as const

/** Texte prêt à coller : titre + description optimisée + prix (spec Kit de Vente). */
export const buildKitText = (titre: string, description: string, prixCents: number): string =>
  `${titre}\n\n${description}\n\nPrix : ${formatEur(prixCents)}`

export default function DiffuserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()

  const [listing, setListing] = useState<ApiListing | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copiedOn, setCopiedOn] = useState<string | null>(null)

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

  const prix = listing === null ? null : (listing.prixPublie ?? listing.prixHaut)
  const kitText =
    listing?.titre != null && listing.description != null && prix !== null
      ? buildKitText(listing.titre, listing.description, prix)
      : null

  const copy = async (platformId: string) => {
    if (kitText === null) return
    await Clipboard.setStringAsync(kitText)
    setCopiedOn(platformId)
    setTimeout(() => setCopiedOn(current => (current === platformId ? null : current)), 2000)
  }

  const openApp = async (platform: (typeof PLATFORMS)[number]) => {
    track('cross_post_opened', { marketplace: platform.id, listingId: id })
    try {
      await Linking.openURL(platform.scheme)
    } catch {
      // Application absente du téléphone → site web de la plateforme.
      await Linking.openURL(platform.web)
    }
  }

  return (
    <View style={styles.screen}>
      <StackHeader title="Diffuser" />

      {loadError !== null ? (
        <View style={styles.center}>
          <ErrorBanner message={`Chargement impossible (${loadError}).`} onRetry={load} />
        </View>
      ) : listing === null ? (
        <View style={styles.loading}>
          <Skeleton height={space[8] * 2} round="md" />
          <Skeleton height={space[8] * 2} round="md" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>
            Copiez le texte préparé, ouvrez l’application et collez-le dans votre annonce.
          </Text>

          {kitText === null && (
            <Text accessibilityRole="alert" style={styles.incomplete}>
              Annonce incomplète — validez d’abord le brouillon (titre, description, prix).
            </Text>
          )}

          {PLATFORMS.map(platform => (
            <Card key={platform.id} style={styles.card}>
              <Text style={styles.cardTitle}>{platform.label}</Text>
              <Button
                label={copiedOn === platform.id ? 'Copié !' : 'Copier le texte'}
                accessibilityLabel={`Copier le texte de l’annonce pour ${platform.label}`}
                variant="ghost"
                disabled={kitText === null}
                icon={
                  copiedOn === platform.id ? (
                    <Check size={font.lead} color={theme.bouteille} />
                  ) : (
                    <Copy size={font.lead} color={theme.ink} />
                  )
                }
                onPress={() => void copy(platform.id)}
              />
              <Button
                label="Ouvrir l’application"
                accessibilityLabel={`Ouvrir l’application ${platform.label}`}
                icon={<ExternalLink size={font.lead} color={theme.onDark} />}
                onPress={() => void openApp(platform)}
              />
            </Card>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  center: { flex: 1, padding: space[5] },
  loading: { padding: space[5], gap: space[3] },
  content: { padding: space[5], gap: space[4], paddingBottom: space[7] },

  intro: { fontSize: font.body, lineHeight: line.body, color: theme.muted },
  incomplete: { fontSize: font.small, lineHeight: line.small, fontWeight: '600', color: theme.brique },

  card: { gap: space[3] },
  cardTitle: { fontSize: font.lead, fontWeight: '700', color: theme.ink },
})
