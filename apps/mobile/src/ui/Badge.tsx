import { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { font, radius, space } from '../theme'

interface Props {
  label: string
  fg: string
  bg: string
  /** Icône Lucide optionnelle (taille 12–14), avant le libellé. */
  icon?: ReactNode
}

/** Étiquette pilule — sémantique portée par fg/bg (STATUS_META, TX_META…). */
export function Badge({ label, fg, bg, icon }: Props) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {icon}
      <Text style={[styles.text, { color: fg }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    alignSelf: 'flex-start',
  },
  text: { fontSize: font.caption, fontWeight: '600' },
})
