import { Redirect, Tabs } from 'expo-router'
import { useAuthStore } from '../../src/store/auth.store'

export default function TabsLayout() {
  // Garde d'auth : tout l'espace (tabs) exige un JWT (persisté MMKV).
  const token = useAuthStore(s => s.token)
  if (!token) return <Redirect href="/login" />

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Capture' }} />
      <Tabs.Screen name="listings" options={{ title: 'Annonces' }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet' }} />
    </Tabs>
  )
}
