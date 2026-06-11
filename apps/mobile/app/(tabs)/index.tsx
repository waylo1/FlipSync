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
import { useVision } from '../../src/hooks/useVision'
import { useListingSession } from '../../src/store/listing.store'

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
        <Text style={styles.title}>Caméra requise</Text>
        <Text style={styles.hint}>
          FlipSync photographie vos objets pour générer l'annonce automatiquement.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={() => void Linking.openSettings()}>
          <Text style={styles.primaryBtnText}>Ouvrir les réglages</Text>
        </Pressable>
      </View>
    )
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Aucune caméra détectée</Text>
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
        <View style={styles.banner}>
          {modelStatus === 'downloading' && (
            <Text style={styles.bannerText}>
              Téléchargement du modèle ({downloadingFile ?? '…'}) —{' '}
              {Math.round(downloadProgress * 100)}%
            </Text>
          )}
          {(modelStatus === 'checking' || modelStatus === 'loading') && (
            <Text style={styles.bannerText}>Préparation du modèle…</Text>
          )}
          {modelStatus === 'error' && (
            <Pressable onPress={retryModelSetup}>
              <Text style={styles.bannerText}>
                Modèle indisponible ({modelErrorCode ?? 'inconnu'}) — touchez pour réessayer
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Thumbnails de la session de capture. */}
      {photos.length > 0 && (
        <ScrollView horizontal style={styles.thumbRow} contentContainerStyle={styles.thumbRowContent}>
          {photos.map(p => (
            <Image key={p.sha256} source={{ uri: p.uri }} style={styles.thumb} />
          ))}
        </ScrollView>
      )}

      {/* Commandes bas d'écran. */}
      <View style={styles.controls}>
        <Pressable
          style={[styles.shutter, (capturing || photos.length >= MAX_PHOTOS) && styles.disabled]}
          onPress={() => void takePhoto()}
          disabled={capturing || photos.length >= MAX_PHOTOS}
        >
          {capturing ? <ActivityIndicator color="#000" /> : <View style={styles.shutterInner} />}
        </Pressable>

        <Pressable
          style={[styles.primaryBtn, (!ready || photos.length === 0 || analyzing) && styles.disabled]}
          onPress={() => void runAnalysis()}
          disabled={!ready || photos.length === 0 || analyzing}
        >
          {analyzing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>
              Analyser ({photos.length}/{MAX_PHOTOS})
            </Text>
          )}
        </Pressable>
      </View>

      {/* Erreur d'inférence → l'appelant API marquera AI_FAILED avec ce code. */}
      {errorCode && (
        <View style={[styles.banner, styles.bannerError]}>
          <Text style={styles.bannerText}>Analyse échouée : {errorCode}</Text>
        </View>
      )}

    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 22, fontWeight: '700' },
  hint: { fontSize: 14, opacity: 0.6, textAlign: 'center' },

  banner: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 10,
    padding: 12,
  },
  bannerError: { top: 110, backgroundColor: 'rgba(160,32,32,0.85)' },
  bannerText: { color: '#fff', fontSize: 13, textAlign: 'center' },

  thumbRow: { position: 'absolute', bottom: 140, left: 0, right: 0, maxHeight: 72 },
  thumbRowContent: { paddingHorizontal: 16, gap: 8 },
  thumb: { width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderColor: '#fff' },

  controls: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
    borderColor: '#000',
  },
  primaryBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  primaryBtnText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.4 },
})
