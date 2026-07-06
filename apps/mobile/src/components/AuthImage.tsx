import { Image, ImageProps, ImageURISource } from 'react-native'
import { useAuthStore } from '../store/auth.store'

interface Props extends Omit<ImageProps, 'source'> {
  uri: string
}

/**
 * Image authentifiée — joint le JWT à la requête : /uploads est protégé
 * côté serveur (401 sans token). À utiliser pour TOUTE image servie par l'API ;
 * les fichiers locaux (previews de capture) restent sur <Image> standard.
 */
export function AuthImage({ uri, ...rest }: Props) {
  const token = useAuthStore(s => s.token)
  const source: ImageURISource =
    token !== null ? { uri, headers: { authorization: `Bearer ${token}` } } : { uri }
  return <Image source={source} {...rest} />
}
