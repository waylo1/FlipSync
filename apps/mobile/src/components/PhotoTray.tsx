import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Dimensions,
  Image,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native'
import { X } from 'lucide-react-native'
import { font, radius, space, theme } from '../theme'

export interface TrayPhoto {
  uri: string
  sha256: string
}

interface Props {
  photos: TrayPhoto[]
  /** Nouvel ordre complet après un glisser-déposer. */
  onReorder: (next: TrayPhoto[]) => void
  onRemove: (sha256: string) => void
}

const GAP = space[2]
const MAX_SLOT = space[8] + GAP // 64 + 8
const LIFT_SCALE = 1.12
/** Seuil de mouvement horizontal qui distingue un glissement d'un simple tap. */
const DRAG_THRESHOLD = 6

/**
 * Bandeau de photos réordonnable par glissement (sans dépendance native).
 * Le tap sur la croix supprime ; un glissement horizontal réordonne. Positions
 * absolues animées : l'élément saisi suit le doigt, les autres se décalent.
 */
export function PhotoTray({ photos, onReorder, onRemove }: Props) {
  const [containerW, setContainerW] = useState(Dimensions.get('window').width - space[4] * 2)
  const count = photos.length
  const slotW = useMemo(
    () => (count > 0 ? Math.min(containerW / count, MAX_SLOT) : MAX_SLOT),
    [containerW, count],
  )
  const thumbSize = Math.max(slotW - GAP, space[6])

  // translateX animé par sha256 — persiste entre les rendus (Map en ref).
  const valuesRef = useRef<Map<string, Animated.Value>>(new Map())
  const [draggingSha, setDraggingSha] = useState<string | null>(null)

  // Garde une valeur animée par photo présente ; purge celles disparues.
  const values = valuesRef.current
  photos.forEach((p, i) => {
    if (!values.has(p.sha256)) values.set(p.sha256, new Animated.Value(i * slotW))
  })
  for (const key of Array.from(values.keys())) {
    if (!photos.some(p => p.sha256 === key)) values.delete(key)
  }

  // Réaligne chaque vignette (hors celle saisie) sur sa position d'index.
  useEffect(() => {
    photos.forEach((p, i) => {
      if (p.sha256 === draggingSha) return
      const v = values.get(p.sha256)
      if (!v) return
      Animated.spring(v, { toValue: i * slotW, useNativeDriver: true, bounciness: 6 }).start()
    })
  }, [photos, slotW, draggingSha, values])

  // Refs lues dans les handlers PanResponder (créés une seule fois par sha256).
  const photosRef = useRef(photos)
  photosRef.current = photos
  const slotRef = useRef(slotW)
  slotRef.current = slotW

  const respondersRef = useRef<Map<string, ReturnType<typeof PanResponder.create>>>(new Map())

  function responderFor(sha256: string) {
    const existing = respondersRef.current.get(sha256)
    if (existing) return existing

    let anchorIndex = 0
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // Ne prend la main que sur un mouvement franchement horizontal → le tap
      // (croix de suppression) passe au travers.
      onMoveShouldSetPanResponder: (_evt, g) =>
        Math.abs(g.dx) > DRAG_THRESHOLD && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        anchorIndex = photosRef.current.findIndex(p => p.sha256 === sha256)
        setDraggingSha(sha256)
      },
      onPanResponderMove: (_evt, g) => {
        const v = valuesRef.current.get(sha256)
        if (!v) return
        const x = anchorIndex * slotRef.current + g.dx
        v.setValue(x)

        const target = Math.max(
          0,
          Math.min(photosRef.current.length - 1, Math.round(x / slotRef.current)),
        )
        const currentIndex = photosRef.current.findIndex(p => p.sha256 === sha256)
        if (target !== currentIndex && currentIndex !== -1) {
          const next = photosRef.current.slice()
          const [moved] = next.splice(currentIndex, 1)
          next.splice(target, 0, moved)
          onReorder(next)
        }
      },
      onPanResponderRelease: () => setDraggingSha(null),
      onPanResponderTerminate: () => setDraggingSha(null),
    })
    respondersRef.current.set(sha256, responder)
    return responder
  }

  const onLayout = (e: LayoutChangeEvent) => setContainerW(e.nativeEvent.layout.width)

  return (
    <View style={[styles.container, { height: thumbSize + space[2] }]} onLayout={onLayout}>
      {photos.map((p, i) => {
        const v = values.get(p.sha256) ?? new Animated.Value(i * slotW)
        const dragging = p.sha256 === draggingSha
        return (
          <Animated.View
            key={p.sha256}
            {...responderFor(p.sha256).panHandlers}
            style={[
              styles.item,
              {
                width: thumbSize,
                height: thumbSize,
                transform: [{ translateX: v }, { scale: dragging ? LIFT_SCALE : 1 }],
                zIndex: dragging ? 2 : 1,
              },
              dragging && styles.itemDragging,
            ]}
          >
            <Image
              source={{ uri: p.uri }}
              style={[styles.thumb, { width: thumbSize, height: thumbSize }]}
              accessibilityLabel={`Photo ${i + 1} sur ${photos.length} — glissez pour réordonner`}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Supprimer la photo ${i + 1}`}
              onPress={() => onRemove(p.sha256)}
              hitSlop={space[2]}
              style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}
            >
              <X size={font.small} color={theme.onDark} />
            </Pressable>
          </Animated.View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { position: 'relative', paddingTop: space[2] },
  item: { position: 'absolute', top: space[2] },
  itemDragging: {
    shadowColor: theme.ink,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  thumb: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: theme.onDark,
  },
  remove: {
    position: 'absolute',
    top: -space[2],
    right: -space[2],
    width: space[4] + space[1],
    height: space[4] + space[1],
    borderRadius: radius.pill,
    backgroundColor: theme.scrimBrique,
    borderWidth: 1,
    borderColor: theme.onDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePressed: { opacity: 0.6 },
})
