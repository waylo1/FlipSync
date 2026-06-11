import { StyleSheet, Text, View } from 'react-native'
import { centsToEur } from '@flipsync/core'

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
    <View style={styles.box}>
      <Text style={styles.title}>Prix au-dessus du marché</Text>
      <Text style={styles.body}>
        Votre prix ({centsToEur(prixPublie).toFixed(2)} €) dépasse de plus de 20 % l'estimation
        haute ({centsToEur(prixHaut).toFixed(2)} €). Au-delà de{' '}
        {centsToEur(ceiling).toFixed(2)} €, l'annonce risque de ne pas trouver preneur.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  title: { fontWeight: '700', color: '#92400e' },
  body: { fontSize: 13, color: '#92400e' },
})
