import { StyleSheet, Text, View } from 'react-native'
import { font, radius, space, theme } from '../theme'

/** En-tête d'écran : titre + trait laiton — identique partout (cohérence P6). */
export function ScreenHeader({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      <View style={styles.accent} />
    </View>
  )
}

const styles = StyleSheet.create({
  header: { paddingTop: space[8], paddingHorizontal: space[5], paddingBottom: space[3] },
  heading: { fontSize: font.heading, fontWeight: '800', color: theme.ink },
  accent: {
    width: space[7] - space[1],
    height: space[1],
    borderRadius: radius.xs,
    backgroundColor: theme.gold,
    marginTop: space[2],
  },
})
