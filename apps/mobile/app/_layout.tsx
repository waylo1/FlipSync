import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { bootstrapVision } from '../src/services/vision-bootstrap'

export default function RootLayout() {
  useEffect(() => {
    // Provisioning GGUF + chargement modèle au démarrage, JAMAIS à la demande
    // (cf. gotchas.md). Non bloquant : l'UI suit la progression via useModelStore.
    bootstrapVision().catch(() => {
      // Déjà reflété dans useModelStore (status 'error' + code) — l'écran de
      // capture proposera un retry ; wallet et suivi restent utilisables.
    })
  }, [])

  return <Stack screenOptions={{ headerShown: false }} />
}
