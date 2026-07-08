import { StyleSheet, Text, View } from 'react-native'
import { UserRound } from 'lucide-react-native'
import { radius, theme } from '../theme'

interface Props {
  /** Email du compte — la pastille affiche son initiale ; icône générique sinon. */
  email?: string | null
  /** Diamètre en pt (36 = en-tête, 64+ = écran profil). */
  size?: number
}

/** Pastille ronde d'identité — initiale du compte sur fond laiton. */
export function Avatar({ email, size = 36 }: Props) {
  const initial = email?.trim().charAt(0).toUpperCase() ?? null
  return (
    <View
      style={[styles.circle, { width: size, height: size }]}
      accessibilityElementsHidden // décoratif : le parent porte le libellé
    >
      {initial ? (
        <Text style={[styles.initial, { fontSize: size * 0.45 }]}>{initial}</Text>
      ) : (
        <UserRound size={size * 0.55} color={theme.ink} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  circle: {
    borderRadius: radius.pill,
    backgroundColor: theme.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.goldDark,
  },
  initial: { color: theme.ink, fontWeight: '800' },
})
