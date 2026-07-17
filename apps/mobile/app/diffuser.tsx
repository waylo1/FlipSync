import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import { Check, Copy, ExternalLink, Share2 } from 'lucide-react-native'
import { ListingStatus } from '@flipsync/core'
import type { MarketplaceConnection, MarketplaceId, PublicationOutcome } from '@flipsync/core'
import { ApiError, ApiListing, api } from '../src/services/api'
import { useApiResource } from '../src/hooks/useApiResource'
import { PLATFORM_LABEL, STATE_META } from '../src/components/MarketplaceStatus'
import { StatusBadge } from '../src/components/StatusBadge'
import { font, formatEur, line, radius, space, theme } from '../src/theme'
import { Badge } from '../src/ui/Badge'
import { Button } from '../src/ui/Button'
import { Card } from '../src/ui/Card'
import { ErrorBanner } from '../src/ui/ErrorBanner'
import { Skeleton } from '../src/ui/Skeleton'
import { StackHeader } from '../src/ui/StackHeader'

/**
 * Diffuser — deux chemins, choisis par l'API et non par cet écran (CC-7 : la
 * liste des plateformes et leur éligibilité viennent de GET /marketplace/status) :
 *
 * - canal CONNECTED  → publication réelle via POST /listing/:id/publish ;
 * - canal non connecté → kit manuel (presse-papier + deep link), restauré de
 *   14db154 : tant que les accès partenaires ne sont pas ouverts, l'utilisateur
 *   colle l'annonce lui-même. C'est le mode nominal de la v1.
 *
 * Aucune bascule à faire le jour des credentials : le canal passe CONNECTED
 * côté serveur et remonte tout seul dans le bloc automatique.
 */
// ─── Tracking — seam locale (décision Run 5) ─────────────────────────────────
// Aucun pipeline analytics mobile aujourd'hui : log en dev, no-op en prod.
// Point de branchement UNIQUE le jour où un vrai collecteur existe.
type TrackEvent = 'cross_post_opened'
const track = (event: TrackEvent, props: Readonly<Record<string, string>>): void => {
  if (__DEV__) console.log(`[track] ${event}`, props)
}

/**
 * Mapping PRÉSENTATIONNEL uniquement (deep link + fallback web) — exception
 * CC-7 explicite : la LISTE des canaux vient de l'API, ceci ne fait que dire
 * quelle app ouvrir. Un canal absent d'ici reste copiable, sans bouton "ouvrir".
 */
const PLATFORM_LINK: Readonly<Partial<Record<MarketplaceId, { scheme: string; web: string }>>> = {
  VINTED: { scheme: 'vinted://', web: 'https://www.vinted.fr' },
  LEBONCOIN: { scheme: 'leboncoin://', web: 'https://www.leboncoin.fr' },
}

/** Texte prêt à coller : titre + description optimisée + prix (spec Kit de Vente). */
export const buildKitText = (titre: string, description: string, prixCents: number): string =>
  `${titre}\n\n${description}\n\nPrix : ${formatEur(prixCents)}`

/**
 * Kit manuel d'un canal non connecté — copie l'annonce puis ouvre l'app de la
 * plateforme. Ne touche jamais au statut du listing : rien ne prouve, côté
 * serveur, que l'utilisateur a réellement collé et publié (cf. Q13, MASTER-REMED).
 */
function ManualKit({
  connection,
  kitText,
  listingId,
}: {
  connection: MarketplaceConnection
  kitText: string | null
  listingId: string
}) {
  const [copied, setCopied] = useState(false)
  const label = PLATFORM_LABEL[connection.marketplace]
  const link = PLATFORM_LINK[connection.marketplace]

  const copy = async () => {
    if (kitText === null) return
    await Clipboard.setStringAsync(kitText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const openApp = async () => {
    if (!link) return
    track('cross_post_opened', { marketplace: connection.marketplace, listingId })
    try {
      await Linking.openURL(link.scheme)
    } catch {
      // Application absente du téléphone → site web de la plateforme.
      await Linking.openURL(link.web)
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.resultRow}>
        <Text style={styles.cardTitle}>{label}</Text>
        <Badge label="À coller vous-même" fg={theme.krafInk} bg={theme.kraft} numberOfLines={1} />
      </View>
      <Button
        label={copied ? 'Annonce copiée' : "Copier l'annonce"}
        variant={copied ? 'laiton' : 'primary'}
        icon={
          copied ? (
            <Check size={font.lead} color={theme.ink} />
          ) : (
            <Copy size={font.lead} color={theme.onDark} />
          )
        }
        onPress={() => void copy()}
        disabled={kitText === null}
        accessibilityLabel={copied ? `Annonce copiée pour ${label}` : `Copier l'annonce pour ${label}`}
      />
      {link !== undefined && (
        <Button
          label={`Ouvrir ${label}`}
          variant="ghost"
          icon={<ExternalLink size={font.lead} color={theme.ink} />}
          onPress={() => void openApp()}
        />
      )}
    </Card>
  )
}

export default function DiffuserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const [listing, setListing] = useState<ApiListing | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const status = useApiResource(api.getMarketplaceStatus)

  const [selected, setSelected] = useState<ReadonlySet<MarketplaceId>>(new Set())
  const preselected = useRef(false)
  const [publishing, setPublishing] = useState(false)
  const [publishErr, setPublishErr] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<PublicationOutcome | null>(null)

  const load = useCallback(() => {
    if (!id) return
    setLoadError(null)
    api
      .getListing(id)
      .then(({ listing: l }) => setListing(l))
      .catch(err => setLoadError(err instanceof ApiError ? err.code : 'UNKNOWN'))
  }, [id])

  useEffect(() => load(), [load])

  // Présélection unique : les canaux déjà utilisables (réel ou simulé) —
  // jamais ceux indisponibles ; l'utilisateur reste libre d'ajuster ensuite.
  useEffect(() => {
    if (preselected.current || !status.data) return
    preselected.current = true
    const ready = status.data.connections.filter(c => c.state === 'CONNECTED').map(c => c.marketplace)
    setSelected(new Set(ready))
  }, [status.data])

  if (!id) return <Redirect href="/(tabs)" />

  const toggle = (marketplace: MarketplaceId) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(marketplace)) next.delete(marketplace)
      else next.add(marketplace)
      return next
    })
  }

  const publish = async () => {
    if (!id || selected.size === 0) return
    setPublishing(true)
    setPublishErr(null)
    try {
      setOutcome(await api.publish(id, Array.from(selected)))
    } catch (err) {
      setPublishErr(err instanceof ApiError ? err.code : 'UNKNOWN')
    } finally {
      setPublishing(false)
    }
  }

  const price = listing === null ? null : (listing.prixPublie ?? listing.prixHaut)
  const diffusable = listing?.titre != null && listing?.description != null && price !== null
  const queued = listing?.status === ListingStatus.QUEUED

  const kitText =
    listing?.titre != null && listing.description != null && price !== null
      ? buildKitText(listing.titre, listing.description, price)
      : null

  // Le partage entre les deux chemins est une donnée de l'API, pas une décision
  // de cet écran : un canal devient automatique dès qu'il passe CONNECTED côté
  // serveur, sans rien changer ici (CC-7).
  const connections = status.data?.connections ?? []
  const autoChannels = connections.filter(c => c.state === 'CONNECTED')
  const manualChannels = connections.filter(c => c.state !== 'CONNECTED')

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
      ) : !queued ? (
        <View style={styles.content}>
          <Text style={styles.intro}>Cette annonce a déjà été traitée.</Text>
          <View style={styles.statusRow}>
            <StatusBadge status={listing.status} />
          </View>
          <Button label="Retour à l'annonce" variant="ghost" onPress={() => router.back()} />
        </View>
      ) : outcome !== null ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>
            {outcome.status === ListingStatus.PUBLISHED
              ? 'Publication terminée — au moins une plateforme est en ligne.'
              : 'Échec sur toutes les plateformes sélectionnées — remboursement automatique effectué.'}
          </Text>
          {outcome.results.map(r => (
            <Card key={r.marketplace} style={styles.card}>
              <View style={styles.resultRow}>
                <Text style={styles.cardTitle}>{PLATFORM_LABEL[r.marketplace]}</Text>
                <Badge
                  label={r.ok ? 'Publié' : (r.code ?? 'Échec')}
                  fg={r.ok ? theme.bouteille : theme.brique}
                  bg={r.ok ? theme.bouteilleSoft : theme.briqueSoft}
                />
              </View>
              {r.ok && r.url != null && r.url !== '' && (
                <Button
                  label="Voir l'annonce en ligne"
                  variant="ghost"
                  icon={<ExternalLink size={font.lead} color={theme.ink} />}
                  onPress={() => void Linking.openURL(r.url as string)}
                />
              )}
            </Card>
          ))}
          <Button label="Retour à l'annonce" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {diffusable === false && (
            <Text accessibilityRole="alert" style={styles.incomplete}>
              Annonce incomplète — validez d'abord le brouillon (titre, description, prix).
            </Text>
          )}

          {status.error !== null && status.data === null ? (
            <ErrorBanner message="Impossible de charger l'état des plateformes." onRetry={status.retry} />
          ) : status.data === null ? (
            <Skeleton height={space[8] * 4} round="md" />
          ) : (
            <>
              {autoChannels.length > 0 && (
                <>
                  <Text style={styles.intro}>
                    Choisissez les plateformes sur lesquelles publier cette annonce.
                  </Text>
                  {autoChannels.map(connection => {
                    const meta = STATE_META[connection.state]
                    const label = connection.mock ? `${meta.label} (simulation)` : meta.label
                    const checked = selected.has(connection.marketplace)
                    return (
                      <Pressable
                        key={connection.marketplace}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                        accessibilityLabel={`${PLATFORM_LABEL[connection.marketplace]} : ${label}`}
                        onPress={() => toggle(connection.marketplace)}
                        style={styles.channelRow}
                      >
                        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                          {checked && <Check size={font.small} color={theme.onDark} />}
                        </View>
                        <Text style={styles.channelLabel}>{PLATFORM_LABEL[connection.marketplace]}</Text>
                        <Badge label={label} fg={meta.fg} bg={meta.bg} numberOfLines={1} />
                      </Pressable>
                    )
                  })}

                  {publishErr !== null && (
                    <ErrorBanner
                      message={`Publication impossible (${publishErr}).`}
                      onRetry={() => void publish()}
                    />
                  )}

                  <Button
                    label={
                      selected.size === 0
                        ? 'Choisissez une plateforme'
                        : `Publier sur ${selected.size} plateforme${selected.size > 1 ? 's' : ''}`
                    }
                    icon={<Share2 size={font.lead} color={theme.onDark} />}
                    onPress={() => void publish()}
                    disabled={selected.size === 0 || diffusable === false}
                    loading={publishing}
                  />
                </>
              )}

              {manualChannels.length > 0 && (
                <>
                  <Text style={styles.intro}>
                    {autoChannels.length > 0
                      ? 'Sur ces plateformes, la publication automatique n’est pas encore ouverte : copiez l’annonce et collez-la vous-même.'
                      : 'Votre annonce est prête. Copiez-la et collez-la sur la plateforme de votre choix — la publication automatique arrive bientôt.'}
                  </Text>
                  {manualChannels.map(connection => (
                    <ManualKit
                      key={connection.marketplace}
                      connection={connection}
                      kitText={kitText}
                      listingId={id}
                    />
                  ))}
                </>
              )}
            </>
          )}
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

  statusRow: { flexDirection: 'row' },

  card: { gap: space[3] },
  cardTitle: { fontSize: font.lead, fontWeight: '700', color: theme.ink },
  resultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },

  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.md,
    padding: space[3],
  },
  checkbox: {
    width: space[5],
    height: space[5],
    borderRadius: radius.xs,
    borderWidth: 2,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: theme.terracotta, borderColor: theme.terracotta },
  channelLabel: { flex: 1, fontSize: font.body, fontWeight: '600', color: theme.ink },
})
