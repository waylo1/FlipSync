/** Date relative en français simple — « il y a 5 min », « hier », « 12/03/2026 ». */
export function formatRelativeFr(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then

  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`

  const hours = Math.floor(min / 60)
  if (hours < 24) return `il y a ${hours} h`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'hier'
  if (days < 7) return `il y a ${days} j`

  return new Date(iso).toLocaleDateString('fr-FR')
}
