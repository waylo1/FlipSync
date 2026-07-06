import { ReactNode } from 'react'
import { StyleSheet, View, ViewStyle } from 'react-native'
import { radius, shadow, space, theme } from '../theme'

interface Props {
  children: ReactNode
  style?: ViewStyle
}

/** Carte papier posée sur l'étal — fond card, bordure sable, ombre diffuse. */
export function Card({ children, style }: Props) {
  return <View style={[styles.card, style]}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: space[4],
    ...shadow.card,
  },
})
