import { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { MarketplaceConnection, MarketplaceConnectionState, MarketplaceId } from '@flipsync/core'
import { font, space, theme } from '../theme'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'

const PLATFORM_LABEL: Readonly<Record<MarketplaceId, string>> = {
  VINTED: 'Vinted',
  LEBONCOIN: 'Leboncoin',
  // Core Sync Engine (ADR-009) — libellés prêts, l'écran n'affiche que ce que
  // GET /marketplace/status renvoie (rien tant que les connecteurs sont bouchonnés).
  EBAY: 'eBay',
  SHOPIFY: 'Shopify',
}

/**
 * Sémantique couleur alignée sur STATUS_META : bouteille = opérationnel,
 * kraft = absent (neutre — l'accès partenaire n'est pas encore ouvert),
 * moutarde = vigilance (expiré), brique = échec (refus plateforme).
 */
const STATE_META: Readonly<Record<MarketplaceConnectionState, { label: string; fg: string; bg: string }>> = {
  CONNECTED: { label: 'Connecté', fg: theme.bouteille, bg: theme.bouteilleSoft },
  DISCONNECTED: { label: 'Déconnecté', fg: theme.krafInk, bg: theme.kraft },
  EXPIRED: { label: 'Expiré', fg: theme.moutarde, bg: theme.moutardeSoft },
  AUTH_ERROR: { label: "Erreur d'authentification", fg: theme.brique, bg: theme.briqueSoft },
}

const ConnectionRow = memo(function ConnectionRow({ connection }: { connection: MarketplaceConnection }) {
  const meta = STATE_META[connection.state]
  const label = connection.mock ? `${meta.label} (simulation)` : meta.label
  return (
    <View
      accessibilityLabel={`${PLATFORM_LABEL[connection.marketplace]} : ${label}`}
      style={styles.row}
    >
      <Text style={styles.platform}>{PLATFORM_LABEL[connection.marketplace]}</Text>
      <View style={styles.stateCell}>
        <Badge label={label} fg={meta.fg} bg={meta.bg} numberOfLines={1} />
        {connection.detail !== null && <Text style={styles.detail}>{connection.detail}</Text>}
      </View>
    </View>
  )
})

/**
 * États de connexion aux plateformes (GET /marketplace/status) — purement
 * présentational : le fetch (focus + retry) reste à l'écran appelant.
 */
export function MarketplaceStatus({ connections }: { connections: readonly MarketplaceConnection[] }) {
  return (
    <Card style={styles.card}>
      {connections.map(connection => (
        <ConnectionRow key={connection.marketplace} connection={connection} />
      ))}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  platform: { fontSize: font.body, fontWeight: '600', color: theme.ink },
  stateCell: { alignItems: 'flex-end', gap: space[1], flexShrink: 1 },
  detail: { fontSize: font.caption, color: theme.muted },
})
