import { useEffect } from 'react'
import { Stack, usePathname } from 'expo-router'
import * as FileSystem from 'expo-file-system'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { initDevSession, trackNavigation } from '../src/dev-session/recorder'
import { registerForPushNotifications } from '../src/lib/push-notifications'
import { useAuthStore } from '../src/store/auth.store'

export default function RootLayout() {
  const pathname = usePathname()
  const token = useAuthStore(s => s.token)

  // §7, Lot 9 : enregistre le device dès qu'une session est active — best-effort,
  // ne bloque jamais le rendu (cf. src/lib/push-notifications.ts).
  useEffect(() => {
    if (token) void registerForPushNotifications()
  }, [token])

  useEffect(() => {
    // Pivot IA serveur : plus aucun modèle embarqué. On efface les GGUF
    // téléchargés par les anciennes versions (~1,8 Go) pour rendre l'espace.
    void FileSystem.deleteAsync(`${FileSystem.documentDirectory}models/`, {
      idempotent: true,
    }).catch(() => {
      // Rien à faire : dossier verrouillé ou déjà absent — aucun impact app.
    })
  }, [])

  // Developer Control Center — capture auto en dev (cf. src/dev-session/recorder.ts).
  useEffect(() => initDevSession(), [])
  useEffect(() => {
    trackNavigation(pathname)
  }, [pathname])

  return (
    <SafeAreaProvider>
      {/* Fond papier clair partout → contenu de la barre système en sombre. */}
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        {/* S5 — feuille modale (§5.5) : entrée par le bas, au-dessus du dashboard S4. */}
        <Stack.Screen name="mission-validate" options={{ presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  )
}
