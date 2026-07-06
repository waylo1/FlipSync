import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
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
import { useVision } from '../../src/hooks/useVision'
import { useListingSession } from '../../src/store/listing.store'
import { font, line, radius, space, theme } from '../../src/theme'
import { Button } from '../../src/ui/Button'
import { EmptyState } from '../../src/ui/EmptyState'

const MAX_PHOTOS = 5
/**
 * Largeur d'analyse : l'encodeur vision de Moondream2 travaille en ~378 px —
 * 768 px garde une marge de recadrage sans exploser la RAM de l'inférence.
 */
const ANALYZE_WIDTH = 768

interface CapturedPhoto {
  uri: string // jpeg redimensionné (thumbnail + upload futur)
  base64: string // payload envoyé au modèle
  sha256: string // intégrité (rules.md) — réutilisé à la création du listing
}

export default function CaptureScreen() {
  const router = useRouter()
  const camera = useRef<Camera>(null)
  const isFocused = useIsFocused()
  const device = useCameraDevice('back')
  const { hasPermission, requestPermission } = useCameraPermission()

  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [capturing, setCapturing] = useState(false)

  const {
    ready,
    modelStatus,
    downloadProgress,
    downloadingFile,
    modelErrorCode,
    retryModelSetup,
    analyzing,
    errorCode,
    analyze,
  } = useVision()

  useEffect(() => {
    if (!hasPermission) void requestPermission()
  }, [hasPermission, requestPermission])

  /** Capture → resize 768px JPEG → base64 + sha256. */
  const takePhoto = useCallback(async () => {
    if (!camera.current || capturing || photos.length >= MAX_PHOTOS) return
    setCapturing(true)
    try {
      const raw = await camera.current.takePhoto({ flash: 'off' })
      const resized = await manipulateAsync(
        `file://${raw.path}`,
        [{ resize: { width: ANALYZE_WIDTH } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true },
      )
      if (!resized.base64) throw new Error('BASE64_MISSING')

      const sha256 = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        resized.base64,
      )
      setPhotos(prev => [...prev, { uri: resized.uri, base64: resized.base64 ?? '', sha256 }])
    } finally {
      setCapturing(false)
    }
  }, [capturing, photos.length])

  /** Inférence on-device puis passage à l'écran de validation (draft + photos). */
  const runAnalysis = useCallback(async () => {
    if (photos.length === 0 || !ready || analyzing) return
    const result = await analyze(photos.map(p => p.base64))
    if (result) {
      useListingSession.getState().setSession(result, photos)
      setPhotos([])
      router.push('/validate')
    }
  }, [photos, ready, analyzing, analyze, router])

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

      {/* Bandeau état modèle — visible tant que l'inférence n'est pas prête. */}
      {modelStatus !== 'ready' && (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          {modelStatus === 'downloading' && (
            <View style={styles.bannerBody}>
              <Text style={styles.bannerText}>
                Préparation de l'assistant ({downloadingFile ?? '…'}) —{' '}
                {Math.round(downloadProgress * 100)}%
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.round(downloadProgress * 100)}%` },
                  ]}
                />
              </View>
            </View>
          )}
          {(modelStatus === 'checking' || modelStatus === 'loading') && (
            <Text style={styles.bannerText}>Préparation de l'assistant…</Text>
          )}
          {modelStatus === 'error' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Réessayer la préparation de l'assistant"
              onPress={retryModelSetup}
              hitSlop={space[2]}
            >
              <Text style={styles.bannerText}>
                Assistant indisponible ({modelErrorCode ?? 'inconnu'}) — touchez pour réessayer
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Thumbnails de la session de capture. */}
      {photos.length > 0 && (
        <ScrollView
          horizontal
          style={styles.thumbRow}
          contentContainerStyle={styles.thumbRowContent}
        >
          {photos.map((p, i) => (
            <Image
              key={p.sha256}
              source={{ uri: p.uri }}
              style={styles.thumb}
              accessibilityLabel={`Photo ${i + 1} sur ${photos.length}`}
            />
          ))}
        </ScrollView>
      )}

      {/* Commandes bas d'écran. */}
      <View style={styles.controls}>
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

        <Button
          label={`Rédiger l'annonce (${photos.length}/${MAX_PHOTOS})`}
          onPress={() => void runAnalysis()}
          loading={analyzing}
          disabled={!ready || photos.length === 0}
        />
      </View>

      {/* Erreur d'inférence → l'appelant API marquera AI_FAILED avec ce code. */}
      {errorCode && (
        <View
          style={[styles.banner, styles.bannerError]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.bannerText}>
            Analyse échouée ({errorCode}) — rien n'est débité, réessayez.
          </Text>
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
  bannerBody: { gap: space[2] },
  bannerText: { color: theme.onDark, fontSize: font.small, lineHeight: line.small, textAlign: 'center' },
  progressTrack: {
    height: space[1],
    borderRadius: radius.xs,
    backgroundColor: theme.krafInk,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: radius.xs, backgroundColor: theme.gold },

  thumbRow: {
    position: 'absolute',
    bottom: space[8] + space[8] + space[5],
    left: 0,
    right: 0,
    maxHeight: space[8] + space[2],
  },
  thumbRowContent: { paddingHorizontal: space[4], gap: space[2] },
  thumb: {
    width: space[8],
    height: space[8],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: theme.onDark,
  },

  controls: {
    // 48 en bas : dégage la barre de gestes système (safe-area, cible primaire).
    position: 'absolute',
    bottom: space[7],
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[5],
  },
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
