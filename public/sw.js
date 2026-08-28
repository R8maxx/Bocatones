/*
 * Service worker de Bocatones — escrito a mano, sin workbox.
 *
 * El proyecto evita dependencias a propósito (SQLite integrado de Node en vez de
 * driver nativo, fuentes autoalojadas, tres dependencias en total), y aquí no
 * hacen falta: los assets ya salen del build con hash, así que la estrategia
 * cabe en un fichero corto.
 *
 * Reparto:
 *   - /api y /ws            → NUNCA se tocan. La fuente de verdad es el
 *                             servidor, y el WebSocket no pasa por caché.
 *   - navegaciones (el HTML) → RED primero, caché de respaldo.
 *   - /assets, fuentes, iconos → CACHÉ primero (llevan hash o no cambian).
 *
 * Esa combinación es la que evita la trampa clásica del service worker: tras un
 * despliegue, la siguiente carga trae el index.html nuevo, que apunta a hashes
 * nuevos, que se piden a la red. No se queda una app vieja pegada para siempre.
 */

// El nombre de la caché lleva el sello del build: vite.config.js sustituye
// __BUILD__ por el commit al compilar. No se toca a mano.
//
// Antes era un número que había que subir CADA VEZ que cambiaba un icono o el
// shell — los .ico/.png van cache-first y sin hash, así que sin renombrar la
// caché el visitante que ya tenía el service worker se quedaba con la copia
// vieja para siempre. Y no se subía nunca. Atado al commit, cada despliegue
// estrena caché y el `activate` de abajo barre la anterior solo.
const CACHE = 'bocatones-__BUILD__'

// lo mínimo para que la app ABRA sin red: el documento, sus iconos y las fuentes
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.ico?v=2', // misma URL que index.html, o el precache no casa con la petición
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/fonts/jetbrains-mono.woff2',
  '/fonts/jetbrains-mono-italic.woff2',
  '/fonts/vt323.woff2',
]

// se piden con cache: 'reload' para no precargar una copia rancia del navegador
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const isStatic = (path) =>
  path.startsWith('/assets/') ||
  path.startsWith('/fonts/') ||
  path.endsWith('.png') ||
  path.endsWith('.ico') ||
  path.endsWith('.webmanifest')

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  // el pedido del día no se cachea jamás: se vería una cola de ayer como si
  // fuera la de hoy, que es peor que no ver nada
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return

  // el documento: red primero, para recoger cada despliegue
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    )
    return
  }

  if (isStatic(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  e.respondWith(fetch(req).catch(() => caches.match(req).then((hit) => hit || Response.error())))
})
