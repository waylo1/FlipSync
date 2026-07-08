import { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { font, radius, space, theme, tracking } from '../theme'

/** En-tête d'écran : titre + trait laiton — identique partout (cohérence P6).
 *  `right` : emplacement optionnel aligné à droite (ex. pastille profil). */
export function ScreenHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.heading}>
          {title}
        </Text>
        {right}
      </View>
      <View style={styles.accent} />
    </View>
  )
}

const styles = StyleSheet.create({
  header: { paddingTop: space[8], paddingHorizontal: space[5], paddingBottom: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: {
    fontSize: font.heading,
    fontWeight: '800',
    color: theme.ink,
    letterSpacing: tracking.heading,
  },
  accent: {
    width: space[7] - space[1],
    height: space[1],
    borderRadius: radius.xs,
    backgroundColor: theme.gold,
    marginTop: space[2],
  },
})
