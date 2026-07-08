import { Redirect, Tabs } from 'expo-router'
import { Camera, Home, PiggyBank } from 'lucide-react-native'
import { useAuthStore } from '../../src/store/auth.store'
import { font, theme } from '../../src/theme'

export default function TabsLayout() {
  // Garde d'auth : tout l'espace (tabs) exige un JWT (persisté MMKV).
  const token = useAuthStore(s => s.token)
  if (!token) return <Redirect href="/login" />

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.goldDark,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: { backgroundColor: theme.card, borderTopColor: theme.border },
        tabBarLabelStyle: { fontSize: font.caption, fontWeight: '600' },
      }}
    >
      {/* Accueil : grille des annonces + recherche + filtres. */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      {/* Vendre au centre (geste principal, à la Instagram). */}
      <Tabs.Screen
        name="vendre"
        options={{
          title: 'Vendre',
          tabBarIcon: ({ color, size }) => <Camera color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Ma cagnotte',
          tabBarIcon: ({ color, size }) => <PiggyBank color={color} size={size} />,
        }}
      />
    </Tabs>
  )
}
