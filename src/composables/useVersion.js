import { onMessage, startRealtime } from '../realtime.js'
import { notifyUpdate } from './useNotices.js'

/*
 * useVersion — avisar cuando el código que se está ejecutando ya es viejo.
 *
 * El problema que resuelve: Bocatones es una vista única sin router, así que
 * quien la deja abierta en la pestaña de la oficina no vuelve a pedir el
 * index.html en toda la mañana. Los datos sí se le actualizan (llegan por
 * WebSocket), pero el código no: se despliega una función nueva y él sigue con
 * la de ayer sin manera de saberlo.
 *
 * Cómo se entera: el servidor manda { type: 'version' } nada más aceptar la
 * conexión, y el WebSocket RECONECTA solo tras el `pm2 restart` del despliegue
 * (backoff en src/realtime.js). O sea que el aviso llega justo en el momento
 * del cambio, sin preguntar cada X segundos por un endpoint.
 *
 * __APP_VERSION__ lo inyecta vite.config.js con el commit del build. En
 * desarrollo vale la cadena que sea, pero el servidor responde 'dev' cuando no
 * hay dist/version.json, así que ahí nunca coincide... y por eso la comparación
 * se salta el caso 'dev': si no, `npm run dev` avisaría de una versión nueva
 * cada vez que se recarga.
 */

const RUNNING = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null

// una sola vez por carga: el WebSocket puede reconectar veinte veces en una
// mañana con mala cobertura, y el aviso ya está puesto desde la primera
let avisado = false
// mismo guardia que en useClassics/useOrders: suscribirse una sola vez aunque
// el composable se llame desde varios sitios
let started = false

export function useVersion() {
  if (started) return
  started = true

  startRealtime()
  onMessage((msg) => {
    if (msg.type !== 'version') return
    if (avisado || !RUNNING || !msg.version) return
    if (msg.version === 'dev' || msg.version === RUNNING) return
    avisado = true
    notifyUpdate()
  })
}
