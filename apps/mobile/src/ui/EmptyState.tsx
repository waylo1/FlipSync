import { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { font, radius, space, theme } from '../theme'

interface Props {
  /** Icône Lucide (taille 32, couleur goldDark recommandée). */
  icon: ReactNode
  title: string
  body: string
  /** Action optionnelle (Button) sous le texte. */
  action?: ReactNode
}

/** État vide chaleureux — ton brocante, jamais culpabilisant. */
export function EmptyState({ icon, title, body, action }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconDisc}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space[3], padding: space[6] },
  iconDisc: {
    width: space[8],
    height: space[8],
    borderRadius: radius.pill,
    backgroundColor: theme.kraft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: font.title, fontWeight: '700', color: theme.ink, textAlign: 'center' },
  body: {
    fontSize: font.body,
    color: theme.muted,
    textAlign: 'center',
    lineHeight: space[5] - space[1],
  },
})
