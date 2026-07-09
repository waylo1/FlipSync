import { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft } from 'lucide-react-native'
import { MIN_TOUCH, font, line, space, theme } from '../theme'

interface Props {
  title: string
  /** Emplacement optionnel aligné à droite du titre (ex. action contextuelle). */
  right?: ReactNode
  /** Retour personnalisé (ex. replace pour éviter d'empiler la pile) — défaut router.back(). */
  onBack?: () => void
}

/**
 * En-tête des écrans empilés (hors tabs) : retour + titre, safe-area haute.
 * Unique source pour Profile, Processing, listing-view, listing-edit — évite
 * la dérive d'alignement qu'entraînait la copie manuelle par écran.
 */
export function StackHeader({ title, right, onBack }: Props) {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.header, { paddingTop: insets.top + space[3] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retour"
        onPress={onBack ?? (() => router.back())}
        hitSlop={space[2]}
        style={styles.back}
      >
        <ArrowLeft size={space[5]} color={theme.ink} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingBottom: space[3],
  },
  back: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, justifyContent: 'center' },
  title: { flex: 1, fontSize: font.title, lineHeight: line.title, fontWeight: '700', color: theme.ink },
})
