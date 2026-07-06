import { Redirect, Tabs } from 'expo-router'
import { Camera, Tag, PiggyBank } from 'lucide-react-native'
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
      <Tabs.Screen
        name="index"
        options={{
          title: 'Photographier',
          tabBarIcon: ({ color, size }) => <Camera color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="listings"
        options={{
          title: 'Mes annonces',
          tabBarIcon: ({ color, size }) => <Tag color={color} size={size} />,
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
