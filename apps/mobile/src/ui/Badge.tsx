import { ReactNode, useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text } from 'react-native'
import { font, motion, radius, space } from '../theme'
import { useReducedMotion } from './useReducedMotion'

interface Props {
  label: string
  fg: string
  bg: string
  /** Icône Lucide optionnelle (taille 12–14), avant le libellé. */
  icon?: ReactNode
}

/**
 * Étiquette pilule — sémantique portée par fg/bg (STATUS_META, TX_META…).
 * Apparition en fondu + micro-zoom (0.9 → 1) : le statut « se pose » sur la
 * carte au lieu de clignoter. Reduced-motion : rendu direct.
 */
export function Badge({ label, fg, bg, icon }: Props) {
  const reduced = useReducedMotion()
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current

  useEffect(() => {
    if (reduced) return
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: motion.dur.base,
      easing: motion.ease.decelerate,
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [progress, reduced])

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] })

  return (
    <Animated.View
      style={[styles.pill, { backgroundColor: bg, opacity: progress, transform: [{ scale }] }]}
    >
      {icon}
      <Text style={[styles.text, { color: fg }]}>{label}</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    alignSelf: 'flex-start',
  },
  text: { fontSize: font.caption, fontWeight: '600' },
})
