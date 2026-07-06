import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/**
 * true si l'utilisateur a demandé la réduction des animations (réglage système).
 * Toute animation doit être supprimable sans perte d'information (gate P5).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then(v => {
      if (mounted) setReduced(v)
    })
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      mounted = false
      sub.remove()
    }
  }, [])

  return reduced
}
