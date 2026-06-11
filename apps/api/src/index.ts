import './env' // charge .env AVANT tout plugin qui lit process.env

import { buildApp } from './app'

async function main(): Promise<void> {
  const app = await buildApp()

  const port = Number(process.env.API_PORT ?? 3001)
  const host = process.env.API_HOST ?? '0.0.0.0'

  const addr = await app.listen({ port, host })
  app.log.info(`FlipSync API → ${addr}`)
}

main().catch(err => {
  // eslint-disable-next-line no-console -- l'app n'a pas pu booter, le logger non plus
  console.error(err)
  process.exit(1)
})
