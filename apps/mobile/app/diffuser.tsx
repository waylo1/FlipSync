import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { Check, ExternalLink, Share2 } from 'lucide-react-native'
import { ListingStatus } from '@flipsync/core'
import type { MarketplaceId, PublicationOutcome } from '@flipsync/core'
import { ApiError, ApiListing, api } from '../src/services/api'
import { useApiResource } from '../src/hooks/useApiResource'
import { PLATFORM_LABEL, STATE_META } from '../src/components/MarketplaceStatus'
import { StatusBadge } from '../src/components/StatusBadge'
import { font, line, radius, space, theme } from '../src/theme'
import { Badge } from '../src/ui/Badge'
import { Button } from '../src/ui/Button'
import { Card } from '../src/ui/Card'
import { ErrorBanner } from '../src/ui/ErrorBanner'
import { Skeleton } from '../src/ui/Skeleton'
import { StackHeader } from '../src/ui/StackHeader'

/**
 * Diffuser — sélection multi-canal (CC-7 : la liste des plateformes et leur
 * état viennent de GET /marketplace/status, aucune logique canal ici) puis
 * publication réelle via POST /listing/:id/publish. Remplace l'ancien kit
 * copier-coller (Run 3) — la publication automatisée existait déjà côté
 * serveur (PublicationService) mais n'était appelée par aucun écran mobile.
 */
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
          <Text style={styles.intro}>Choisissez les plateformes sur lesquelles publier cette annonce.</Text>

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
            status.data.connections.map(connection => {
              const meta = STATE_META[connection.state]
              const label = connection.mock ? `${meta.label} (simulation)` : meta.label
              const disabled = connection.state !== 'CONNECTED'
              const checked = selected.has(connection.marketplace)
              return (
                <Pressable
                  key={connection.marketplace}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled }}
                  accessibilityLabel={`${PLATFORM_LABEL[connection.marketplace]} : ${label}`}
                  onPress={() => !disabled && toggle(connection.marketplace)}
                  disabled={disabled}
                  style={[styles.channelRow, disabled && styles.channelRowDisabled]}
                >
                  <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                    {checked && <Check size={font.small} color={theme.onDark} />}
                  </View>
                  <Text style={styles.channelLabel}>{PLATFORM_LABEL[connection.marketplace]}</Text>
                  <Badge label={label} fg={meta.fg} bg={meta.bg} numberOfLines={1} />
                </Pressable>
              )
            })
          )}

          {publishErr !== null && (
            <ErrorBanner message={`Publication impossible (${publishErr}).`} onRetry={() => void publish()} />
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
  channelRowDisabled: { opacity: 0.5 },
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
