import { useState } from 'react'
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native'
import { font, radius, space, theme } from '../theme'

interface Props extends TextInputProps {
  label: string
  hint?: string
  /** Message d'erreur — borde le champ en brique et est annoncé (a11y). */
  error?: string | null
}

/** Champ de formulaire unique : label lié, focus visible, erreur annoncée. */
export function Field({ label, hint, error, style, ...input }: Props) {
  const [focused, setFocused] = useState(false)

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {hint !== undefined && <Text style={styles.hint}>{hint}</Text>}
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        style={[
          styles.input,
          focused && styles.inputFocused,
          error != null && styles.inputError,
          style,
        ]}
        placeholderTextColor={theme.muted}
        onFocus={e => {
          setFocused(true)
          input.onFocus?.(e)
        }}
        onBlur={e => {
          setFocused(false)
          input.onBlur?.(e)
        }}
        {...input}
      />
      {error != null && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: space[1] },
  label: { fontSize: font.small, fontWeight: '600', color: theme.ink, marginTop: space[3] },
  hint: { fontSize: font.caption, color: theme.muted },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.md,
    padding: space[3],
    fontSize: font.body,
    color: theme.ink,
    backgroundColor: theme.card,
    minHeight: 44,
  },
  inputFocused: { borderColor: theme.goldDark, borderWidth: 2 },
  inputError: { borderColor: theme.brique, borderWidth: 2 },
  error: { fontSize: font.small, color: theme.brique },
})
