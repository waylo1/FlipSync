import { Pressable, StyleSheet, Text, View } from 'react-native'
import { font, radius, space, theme } from '../theme'

interface Props {
  message: string
  /** Action de reprise optionnelle (ex. « Réessayer »). */
  onRetry?: () => void
  retryLabel?: string
}

/** Bandeau d'erreur brique — annoncé aux lecteurs d'écran (role alert). */
export function ErrorBanner({ message, onRetry, retryLabel = 'Réessayer' }: Props) {
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.box}>
      <Text style={styles.text}>{message}</Text>
      {onRetry && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          onPress={onRetry}
          hitSlop={space[2]}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.retryText}>{retryLabel}</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: theme.briqueSoft,
    borderColor: theme.brique,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[3],
    gap: space[2],
  },
  text: { fontSize: font.small, color: theme.brique, fontWeight: '500' },
  retry: { alignSelf: 'flex-start', minHeight: space[6], justifyContent: 'center' },
  retryText: { fontSize: font.small, fontWeight: '700', color: theme.brique },
  pressed: { opacity: 0.7 },
})
