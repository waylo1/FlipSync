import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useIsFocused } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator'
import * as Crypto from 'expo-crypto'
import { CameraOff, Sparkles } from 'lucide-react-native'
import { useAnalysisQueue } from '../../src/store/listing.store'
import { dev } from '../../src/dev-session/recorder'
import { font, line, motion, radius, space, theme } from '../../src/theme'
import { Button } from '../../src/ui/Button'
import { EmptyState } from '../../src/ui/EmptyState'
import { PhotoTray } from '../../src/components/PhotoTray'

const MAX_PHOTOS = 6
/** Aucune restriction par offre : une photo suffit, les suivantes sont facultatives. */
const MIN_PHOTOS = 1
/** Largeur de capture : qualité conservée pour l'annonce publiée (~150-300 Ko/photo). */
const CAPTURE_WIDTH = 768

// Décalages relatifs au sommet de topOverlay / au bas de controls (safe-area déjà
// ajoutée séparément) — évite le chevauchement avec la jauge et le déclencheur,
// quelle que soit la hauteur de l'encoche/barre de gestes du device.
const BANNER_TOP_OFFSET = space[8] + space[6] - space[3] - space[2]
const THUMB_ROW_OFFSET = space[8] + space[5] - space[4] - space[2]

interface CapturedPhoto {
  uri: string // jpeg redimensionné (thumbnail + upload futur)
  base64: string // payload envoyé au serveur pour la rédaction
  sha256: string // intégrité (rules.md) — réutilisé à la création du listing
}

/** Onglet Vendre — caméra active tant que l'onglet a le focus. */
export default function VendreScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const camera = useRef<Camera>(null)
  const isFocused = useIsFocused()
  const device = useCameraDevice('back')
  const { hasPermission, requestPermission } = useCameraPermission()

  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [capturing, setCapturing] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  // Flash de capture : voile blanc bref (feedback immédiat, à la Instagram).
  const flash = useRef(new Animated.Value(0)).current
  const blink = useCallback(() => {
    flash.setValue(0.9)
    Animated.timing(flash, {
      toValue: 0,
      duration: motion.dur.base,
      easing: motion.ease.accelerate,
      useNativeDriver: true,
    }).start()
  }, [flash])

  useEffect(() => {
    if (!hasPermission) void requestPermission()
  }, [hasPermission, requestPermission])

  // Revenir sur l'écran (ex. après avoir réactivé l'accès caméra dans les
  // réglages système) efface l'erreur au lieu de la laisser figée à l'écran.
  useEffect(() => {
    if (isFocused) setCameraError(null)
  }, [isFocused])

  /** Capture → resize 768px JPEG → base64 + sha256. */
  const takePhoto = useCallback(async () => {
    if (!camera.current || capturing || photos.length >= MAX_PHOTOS) return
    setCapturing(true)
    setCameraError(null)
    try {
      const raw = await camera.current.takePhoto({ flash: 'off' })
      blink() // retour visuel immédiat, avant même le resize
      const resized = await manipulateAsync(
        `file://${raw.path}`,
        [{ resize: { width: CAPTURE_WIDTH } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true },
      )
      if (!resized.base64) throw new Error('BASE64_MISSING')

      const sha256 = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        resized.base64,
      )
      setPhotos(prev => [...prev, { uri: resized.uri, base64: resized.base64 ?? '', sha256 }])
      dev.track('photo_added')
    } catch {
      // Caméra fermée/restreinte par l'OS (politique appareil, permission
      // révoquée en cours de session) — jamais laisser la rejection remonter.
      setCameraError('CAMERA_UNAVAILABLE')
    } finally {
      setCapturing(false)
    }
  }, [capturing, photos.length, blink])

  /** Retire une photo ratée de la session de capture (avant rédaction). */
  const removePhoto = useCallback((sha256: string) => {
    setPhotos(prev => prev.filter(p => p.sha256 !== sha256))
  }, [])

  /** Applique le nouvel ordre (glisser-déposer) en conservant les objets complets. */
  const reorderPhotos = useCallback((next: { sha256: string }[]) => {
    setPhotos(prev => {
      const bySha = new Map(prev.map(p => [p.sha256, p]))
      return next.map(n => bySha.get(n.sha256)).filter((p): p is CapturedPhoto => p !== undefined)
    })
  }, [])

  /**
   * Lance la rédaction en TÂCHE DE FOND puis file vers l'écran /processing.
   * L'utilisateur peut y « enchaîner » (revenir photographier l'objet suivant)
   * pendant que le modèle vision travaille — plus de blocage sur cet écran.
   */
  const startAnalysis = useCallback(() => {
    if (photos.length < MIN_PHOTOS) return
    dev.track('create_listing_started')
    useAnalysisQueue.getState().enqueue(photos)
    setPhotos([]) // objet suivant = capture vierge ; le job garde ces photos.
    router.push('/processing')
  }, [photos, router])

  // ─── Branches d'état ──────────────────────────────────────────────────────

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon={<CameraOff size={space[6]} color={theme.goldDark} />}
          title="On a besoin de l'appareil photo"
          body="FlipSync photographie vos objets pour rédiger l'annonce à votre place."
          action={
            <Button label="Ouvrir les réglages" onPress={() => void Linking.openSettings()} />
          }
        />
      </View>
    )
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon={<CameraOff size={space[6]} color={theme.goldDark} />}
          title="Aucune caméra détectée"
          body="Impossible de photographier sur cet appareil."
        />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isFocused}
        photo={true}
      />

      {/* Flash de capture — voile blanc bref au-dessus du viseur. */}
      <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash }]} />

      <View style={[styles.topOverlay, { top: insets.top + space[3] }]}>
        {/* Jauge signature : l'IA "se nourrit" des photos — segments dorés remplis. */}
        <View style={styles.progressWrap} accessibilityLiveRegion="polite">
          <View style={styles.progressRow}>
            <Sparkles size={font.small} color={photos.length >= MIN_PHOTOS ? theme.gold : theme.onDarkMuted} />
            <Text style={styles.progressText}>
              {photos.length === 0
                ? 'Photographiez votre objet sous tous les angles'
                : 'Prêt — ajoutez des photos ou lancez la rédaction'}
            </Text>
          </View>
          <View style={styles.segments}>
            {Array.from({ length: MAX_PHOTOS }, (_, i) => (
              <View key={i} style={[styles.segment, i < photos.length && styles.segmentFilled]} />
            ))}
          </View>
        </View>
      </View>

      {/* Bandeau de photos réordonnable (glisser) + suppression (croix). */}
      {photos.length > 0 && (
        <View style={[styles.thumbRow, { bottom: insets.bottom + space[4] + THUMB_ROW_OFFSET }]}>
          <PhotoTray photos={photos} onReorder={reorderPhotos} onRemove={removePhoto} />
        </View>
      )}

      {/* Commandes bas d'écran — déclencheur centré (à la Instagram), CTA à gauche. */}
      <View style={[styles.controls, { bottom: insets.bottom + space[4] }]}>
        <View style={styles.controlsSide}>
          <Button
            label={photos.length < MIN_PHOTOS ? 'Ajoutez une photo' : 'Rédiger'}
            onPress={() => startAnalysis()}
            disabled={photos.length < MIN_PHOTOS}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Prendre une photo"
          accessibilityState={{ disabled: capturing || photos.length >= MAX_PHOTOS }}
          style={({ pressed }) => [
            styles.shutter,
            pressed && styles.shutterPressed,
            (capturing || photos.length >= MAX_PHOTOS) && styles.disabled,
          ]}
          onPress={() => void takePhoto()}
          disabled={capturing || photos.length >= MAX_PHOTOS}
        >
          {capturing ? <ActivityIndicator color={theme.ink} /> : <View style={styles.shutterInner} />}
        </Pressable>

        {/* Colonne droite vide : garantit le centrage géométrique du déclencheur. */}
        <View style={styles.controlsSide} />
      </View>

      {/* Caméra coupée par l'OS en cours de session (politique appareil, permission révoquée). */}
      {cameraError && (
        <View
          style={[styles.banner, { top: insets.top + space[3] + BANNER_TOP_OFFSET }, styles.bannerError]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.bannerText}>
            Appareil photo indisponible — vérifiez qu'aucun réglage système ne le bloque, puis
            revenez sur cet écran.
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.ink },
  center: { flex: 1, justifyContent: 'center', backgroundColor: theme.paper },

  flash: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.onDark },

  topOverlay: {
    position: 'absolute',
    // top fourni en inline (safe-area insets.top, cf. rendu).
    left: space[4],
    right: space[4],
    gap: space[2],
  },
  progressWrap: {
    gap: space[2],
    backgroundColor: theme.scrim,
    borderRadius: radius.md,
    padding: space[3],
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  progressText: {
    flex: 1,
    color: theme.onDark,
    fontSize: font.small,
    lineHeight: line.small,
    fontWeight: '600',
  },
  segments: { flexDirection: 'row', gap: space[1] },
  segment: {
    flex: 1,
    height: space[1],
    borderRadius: radius.xs,
    backgroundColor: theme.onDarkTrack,
  },
  segmentFilled: { backgroundColor: theme.gold },

  banner: {
    position: 'absolute',
    // top fourni en inline (safe-area insets.top + BANNER_TOP_OFFSET).
    left: space[4],
    right: space[4],
    backgroundColor: theme.scrim,
    borderRadius: radius.md,
    padding: space[3],
  },
  bannerError: { backgroundColor: theme.scrimBrique },
  bannerText: { color: theme.onDark, fontSize: font.small, lineHeight: line.small, textAlign: 'center' },

  thumbRow: {
    position: 'absolute',
    // bottom fourni en inline (safe-area insets.bottom + THUMB_ROW_OFFSET).
    left: space[4],
    right: space[4],
  },

  controls: {
    // bottom fourni en inline (safe-area insets.bottom) : dégage la barre de
    // gestes système quelle que soit sa hauteur réelle sur le device.
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[4],
    gap: space[3],
  },
  // Colonnes symétriques de part et d'autre du déclencheur → il reste pile au centre.
  controlsSide: { flex: 1, alignItems: 'center' },
  shutter: {
    width: space[8] + space[2],
    height: space[8] + space[2],
    borderRadius: radius.pill,
    backgroundColor: theme.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterPressed: { transform: [{ scale: 0.95 }] },
  shutterInner: {
    width: space[8] - space[1],
    height: space[8] - space[1],
    borderRadius: radius.pill,
    borderWidth: space[1] - 1,
    borderColor: theme.ink,
  },
  disabled: { opacity: 0.4 },
})
