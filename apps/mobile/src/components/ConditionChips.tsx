import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ItemCondition } from '@flipsync/core'
import { MIN_TOUCH, font, radius, space, theme } from '../theme'

const CONDITIONS: readonly { value: ItemCondition; label: string }[] = [
  { value: ItemCondition.neuf, label: 'Neuf' },
  { value: ItemCondition.tres_bon, label: 'Très bon' },
  { value: ItemCondition.bon, label: 'Bon' },
  { value: ItemCondition.correct, label: 'Correct' },
]

interface Props {
  value: ItemCondition | null
  onChange: (condition: ItemCondition) => void
}

/**
 * Chips État — partagées entre validate.tsx et listing-edit.tsx (même choix,
 * même rendu). Hauteur fixe + centrage plutôt que padding sur le Pressable
 * répété : le padding sur ce pattern corrompt le rendu du texte sur certains
 * devices Android (glyphes tronqués) — bug isolé empiriquement sur les chips
 * de filtre de l'accueil, même précaution ici.
 */
export function ConditionChips({ value, onChange }: Props) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {CONDITIONS.map(c => {
        const active = value === c.value
        return (
          <Pressable
            key={c.value}
            accessibilityRole="radio"
            accessibilityLabel={`État : ${c.label}`}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
            onPress={() => onChange(c.value)}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
  chip: {
    minHeight: MIN_TOUCH,
    minWidth: space[8] + space[3],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.pill,
    backgroundColor: theme.card,
  },
  chipActive: { backgroundColor: theme.terracotta, borderColor: theme.terracotta },
  chipText: { fontSize: font.small, color: theme.ink, marginHorizontal: space[4] },
  chipTextActive: { color: theme.onDark, fontWeight: '600' },
  pressed: { opacity: 0.7 },
})
