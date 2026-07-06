import { StyleSheet, Text, TextStyle } from 'react-native'
import { MONO, font, formatEur } from '../theme'

interface Props {
  /** Centimes Int — SEUL format d'entrée autorisé (jamais de Float). */
  cents: number
  size?: number
  color?: string
  /** Signe explicite pour les mouvements (+ crédit, − débit). */
  sign?: '+' | '−'
  style?: TextStyle
}

/** Affichage d'argent unique de l'app : MONO tabulaire via formatEur. */
export function AmountText({ cents, size = font.body, color, sign, style }: Props) {
  return (
    <Text style={[styles.amount, { fontSize: size }, color !== undefined && { color }, style]}>
      {sign !== undefined ? `${sign} ` : ''}
      {formatEur(cents)}
    </Text>
  )
}

const styles = StyleSheet.create({
  amount: { fontFamily: MONO, fontWeight: '700', fontVariant: ['tabular-nums'] },
})
