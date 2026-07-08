import { useEffect } from 'react'
import { Stack } from 'expo-router'
import * as FileSystem from 'expo-file-system'

export default function RootLayout() {
  useEffect(() => {
    // Pivot IA serveur : plus aucun modèle embarqué. On efface les GGUF
    // téléchargés par les anciennes versions (~1,8 Go) pour rendre l'espace.
    void FileSystem.deleteAsync(`${FileSystem.documentDirectory}models/`, {
      idempotent: true,
    }).catch(() => {
      // Rien à faire : dossier verrouillé ou déjà absent — aucun impact app.
    })
  }, [])

  return <Stack screenOptions={{ headerShown: false }} />
}
