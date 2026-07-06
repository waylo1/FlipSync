import { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native'
import { font, radius, space, theme } from '../theme'

type Variant = 'primary' | 'laiton' | 'ghost' | 'danger'

interface Props {
  label: string
  onPress: () => void
  variant?: Variant
  loading?: boolean
  disabled?: boolean
  /** Icône Lucide optionnelle, rendue avant le libellé. */
  icon?: ReactNode
  /** Libellé lu par TalkBack/VoiceOver si différent du texte visible. */
  accessibilityLabel?: string
  style?: ViewStyle
}

const VARIANT: Readonly<Record<Variant, { bg: string; fg: string; border?: string }>> = {
  primary: { bg: theme.terracotta, fg: theme.onDark },
  laiton: { bg: theme.gold, fg: theme.ink },
  ghost: { bg: theme.card, fg: theme.ink, border: theme.border },
  danger: { bg: theme.brique, fg: theme.onDark },
}

/** Bouton unique de l'app — cible ≥ 48 pt, retour pressé, état chargement. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  accessibilityLabel,
  style,
}: Props) {
  const colors = VARIANT[variant]
  const inactive = disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: colors.bg },
        colors.border !== undefined && { borderWidth: 1, borderColor: colors.border },
        pressed && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.fg} />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text style={[styles.label, { color: colors.fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  label: { fontSize: font.lead, fontWeight: '700' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.4 },
})
