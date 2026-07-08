import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useIsFocused } from '@react-navigation/native'
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator'
import * as Crypto from 'expo-crypto'
import { CameraOff } from 'lucide-react-native'
import { ApiError, api } from '../../src/services/api'
import { useListingSession, usePendingPublish } from '../../src/store/listing.store'
import { font, line, radius, space, theme } from '../../src/theme'
import { Button } from '../../src/ui/Button'
import { EmptyState } from '../../src/ui/EmptyState'
import { PhotoTray } from '../../src/components/PhotoTray'

const MIN_PHOTOS = 3
const MAX_PHOTOS = 8
/** Largeur de capture : qualité conservée pour l'annonce publiée (~150-300 Ko/photo). */
const CAPTURE_WIDTH = 768
/**
 * Largeur envoyée au modèle vision serveur : 512 px divise par ~2,3 le coût
 * d'encodage image (dominant sur CPU en dev) sans dégrader la compréhension.
 */
const ANALYZE_WIDTH = 512

/** Messages utilisateur — jamais de code technique brut à l'écran. */
const ANALYZE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  NETWORK_ERROR: 'Impossible de joindre le serveur — vérifiez votre connexion, rien n’est débité.',
  TIMEOUT: 'La rédaction a pris trop de temps — rien n’est débité, réessayez.',
  NO_AUTH_TOKEN: 'Session expirée — reconnectez-vous.',
}
const ANALYZE_ERROR_FALLBACK = 'L’analyse n’a pas abouti — rien n’est débité, réessayez.'

interface CapturedPhoto {
  uri: string // jpeg redimensionné (thumbnail + upload futur)
  base64: string // payload envoyé au serveur pour la rédaction
  sha256: string // intégrité (rules.md) — réutilisé à la création du listing
}

/** Onglet Vendre — caméra active tant que l'onglet a le focus. */
export default function VendreScreen() {
  const router = useRouter()
  const camera = useRef<Camera>(null)
  const isFocused = useIsFocused()
  const device = useCameraDevice('back')
  const { hasPermission, requestPermission } = useCameraPermission()

  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [capturing, setCapturing] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

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
    } catch {
      // Caméra fermée/restreinte par l'OS (politique appareil, permission
      // révoquée en cours de session) — jamais laisser la rejection remonter.
      setCameraError('CAMERA_UNAVAILABLE')
    } finally {
      setCapturing(false)
    }
  }, [capturing, photos.length])

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

  /** Rédaction serveur (POST /ai/draft) puis écran de validation (draft + photos). */
  const runAnalysis = useCallback(async () => {
    const primary = photos[0]
    if (photos.length < MIN_PHOTOS || analyzing || !primary) return
    setAnalyzing(true)
    setAnalyzeError(null)
    try {
      // Seule la 1ʳᵉ photo (vue principale) part au modèle : chaque photo coûte
      // ~40-90 s d'encodage sur le serveur CPU de dev. Toutes les photos restent
      // attachées à l'annonce. Avec un GPU en prod : envoyer les 3 premières.
      const forModel = await manipulateAsync(
        primary.uri,
        [{ resize: { width: ANALYZE_WIDTH } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true },
      )
      const { draft } = await api.analyzeDraft([forModel.base64 ?? primary.base64])

      // Nouvelle capture = nouvel objet : une reprise en attente (tentative
      // interrompue d'un AUTRE objet) deviendrait un mélange annonce/photos.
      // On l'abandonne : cancel serveur (gratuit, pré-commit) + purge locale.
      const stale = usePendingPublish.getState().pending
      if (stale) {
        usePendingPublish.getState().clearPending()
        api.cancel(stale.listingId).catch(() => {
          // Déjà annulée/validée côté serveur — rien à rattraper.
        })
      }

      useListingSession.getState().setSession(draft, photos)
      setPhotos([])
      router.push('/validate')
    } catch (err) {
      if (__DEV__) console.error('[vision] analyse serveur échouée:', err)
      const code = err instanceof ApiError ? err.code : 'UNKNOWN'
      setAnalyzeError(ANALYZE_ERROR_MESSAGES[code] ?? ANALYZE_ERROR_FALLBACK)
    } finally {
      setAnalyzing(false)
    }
  }, [photos, analyzing, router])

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

      {/* Rédaction en cours — l'attente est normale (modèle vision serveur). */}
      {analyzing && (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <Text style={styles.bannerText}>
            FlipSync rédige votre annonce — cela peut prendre une minute, restez sur cet écran.
          </Text>
        </View>
      )}

      {/* Bandeau de photos réordonnable (glisser) + suppression (croix). */}
      {photos.length > 0 && (
        <View style={styles.thumbRow}>
          <PhotoTray photos={photos} onReorder={reorderPhotos} onRemove={removePhoto} />
        </View>
      )}

      {/* Commandes bas d'écran — déclencheur centré (à la Instagram), CTA à gauche. */}
      <View style={styles.controls}>
        <View style={styles.controlsSide}>
          <Button
            label={
              photos.length < MIN_PHOTOS
                ? `Encore ${MIN_PHOTOS - photos.length} photo${MIN_PHOTOS - photos.length > 1 ? 's' : ''}`
                : `Rédiger (${photos.length}/${MAX_PHOTOS})`
            }
            onPress={() => void runAnalysis()}
            loading={analyzing}
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
          style={[styles.banner, styles.bannerError]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.bannerText}>
            Appareil photo indisponible — vérifiez qu'aucun réglage système ne le bloque, puis
            revenez sur cet écran.
          </Text>
        </View>
      )}

      {/* Échec de la rédaction serveur — message humain, jamais de code brut. */}
      {analyzeError && !analyzing && (
        <View
          style={[styles.banner, styles.bannerError]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.bannerText}>{analyzeError}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.ink },
  center: { flex: 1, justifyContent: 'center', backgroundColor: theme.paper },

  banner: {
    position: 'absolute',
    top: space[8],
    left: space[4],
    right: space[4],
    backgroundColor: theme.scrim,
    borderRadius: radius.md,
    padding: space[3],
  },
  bannerError: { top: space[8] + space[7], backgroundColor: theme.scrimBrique },
  bannerText: { color: theme.onDark, fontSize: font.small, lineHeight: line.small, textAlign: 'center' },

  thumbRow: {
    position: 'absolute',
    bottom: space[8] + space[8] + space[5],
    left: space[4],
    right: space[4],
  },

  controls: {
    // 48 en bas : dégage la barre de gestes système (safe-area, cible primaire).
    position: 'absolute',
    bottom: space[7],
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
