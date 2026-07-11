import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { api } from '../services/api'

/**
 * Enregistrement du device token Expo Push (§7, Lot 9). Appelé une fois par
 * session authentifiée (cf. app/_layout.tsx) — jamais bloquant : un refus de
 * permission ou un simulateur sans push (`Device.isDevice` false) désactive
 * simplement les notifications, sans jamais gêner le reste de l'app.
 */
export async function registerForPushNotifications(): Promise<void> {
  if (!Device.isDevice) return // simulateur/émulateur : pas de push possible

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  }

  const existing = await Notifications.getPermissionsAsync()
  let status = existing.status
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync()
    status = requested.status
  }
  if (status !== 'granted') return

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined
  const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)

  await api.registerDeviceToken(token).catch(() => {
    // Best-effort : un échec réseau ici ne doit jamais bloquer le démarrage
    // de l'app — la prochaine session réessaiera.
  })
}
