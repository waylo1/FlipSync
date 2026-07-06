import { StyleSheet, Text, View } from 'react-native'
import { AlertTriangle } from 'lucide-react-native'
import { font, radius, space, theme } from '../theme'
import { formatEur } from '../theme'

interface Props {
  prixPublie: number // centimes
  prixHaut: number // centimes — plafond estimé par l'IA
}

/**
 * Règle de diplomatie (cf. CLAUDE.md) : prixPublie > prixHaut × 1.2 → alerte.
 * Non bloquant — l'utilisateur reste maître du prix, le listing part avec
 * isPriceFlagged=true (calculé côté serveur à la validation).
 */
export function PriceFlagAlert({ prixPublie, prixHaut }: Props) {
  const ceiling = Math.round(prixHaut * 1.2)
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.box}>
      <View style={styles.titleRow}>
        <AlertTriangle size={font.body} color={theme.moutarde} />
        <Text style={styles.title}>Prix au-dessus du marché</Text>
      </View>
      <Text style={styles.body}>
        Votre prix ({formatEur(prixPublie)}) dépasse de plus de 20 % l'estimation haute (
        {formatEur(prixHaut)}). Au-delà de {formatEur(ceiling)}, l'annonce risque de ne pas
        trouver preneur.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: theme.moutardeSoft,
    borderColor: theme.moutardeBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[3],
    gap: space[1],
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  title: { fontWeight: '700', color: theme.moutarde, fontSize: font.body },
  body: { fontSize: font.small, color: theme.moutarde, lineHeight: space[4] + space[1] },
})
