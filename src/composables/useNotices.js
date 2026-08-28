import { ref } from 'vue'

/*
 * useNotices — avisos del sistema: errores, confirmaciones y "deshacer".
 *
 * Es un canal DISTINTO del aviso de pedido entrante de App.vue (el bocata que
 * cae con su bocadillo), que tiene personalidad propia y se queda como está.
 * Aquí van los mensajes funcionales, en una pila discreta abajo a la izquierda.
 *
 * Hasta ahora 10 de las 11 mutaciones fallaban en absoluto silencio: se podía
 * escribir un pedido, ver el formulario vaciarse (señal de éxito) y que el
 * pedido no llegara nunca. Este módulo es el sitio donde eso se cuenta.
 */

const notices = ref([])
let seq = 0

// cuánto vive cada tipo de aviso
const TTL = { error: 7000, ok: 3000, undo: 5000 }

function dismiss(id) {
  const n = notices.value.find((x) => x.id === id)
  if (n) clearTimeout(n.timer)
  notices.value = notices.value.filter((x) => x.id !== id)
}

/*
 * Un aviso `persistent` no lleva temporizador: se queda hasta que se pulsa su
 * botón o se descarta. Es para lo que no caduca — hoy solo "hay versión nueva",
 * que sigue siendo verdad a los cuatro segundos y a la media hora.
 */
function push(notice) {
  const id = ++seq
  if (notice.persistent) {
    notices.value = [...notices.value, { ...notice, id, timer: null, ttl: null }]
    return id
  }
  const ttl = notice.ttl ?? TTL[notice.kind] ?? 4000
  const timer = setTimeout(() => {
    notices.value = notices.value.filter((x) => x.id !== id)
    notice.onExpire?.()
  }, ttl)
  notices.value = [...notices.value, { ...notice, id, timer, ttl }]
  return id
}

/* ----------------------------------------------------------------
   Traducir un fallo a algo que se pueda leer
   ---------------------------------------------------------------- */
export function reason(e) {
  const m = e?.message || ''
  // api.js lanza el `error` del servidor, que ya viene en castellano
  if (!m) return 'No se ha podido completar la acción.'
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'El servidor no responde.'
  if (/^HTTP 5/.test(m)) return 'El servidor ha fallado. Inténtalo otra vez.'
  if (/^HTTP 40[34]/.test(m)) return 'Ese dato ya no existe: recarga la página.'
  if (/^HTTP /.test(m)) return 'El servidor ha rechazado la petición.'
  return m
}

export const notifyError = (text, e) => push({ kind: 'error', text, detail: reason(e) })
export const notifyOk = (text) => push({ kind: 'ok', text })

// aviso con deshacer: si se agota el plazo se ejecuta `onExpire` (confirmar),
// si se pulsa deshacer se ejecuta `onUndo` y no se confirma nada.
// `ttl` es opcional: vaciar el día entero merece más margen que una sola baja.
export const notifyUndo = (text, { onUndo, onExpire, ttl }) =>
  push({ kind: 'undo', text, onUndo, onExpire, ttl })

/*
 * Aviso de despliegue: hay una versión nueva y la que se está mirando es vieja
 * (ver src/composables/useVersion.js). No caduca y no recarga solo — recargar
 * por sorpresa a quien está escribiendo un pedido le borra lo escrito, así que
 * la última palabra es suya.
 */
export const notifyUpdate = () =>
  push({
    kind: 'update',
    persistent: true,
    text: 'Hay una versión nueva de Bocatones',
    detail: 'la que ves es de antes del último cambio',
    action: '↻ recargar',
    onAction: () => location.reload(),
  })

export function act(id) {
  const n = notices.value.find((x) => x.id === id)
  if (!n) return
  n.onAction?.()
}

export function undo(id) {
  const n = notices.value.find((x) => x.id === id)
  if (!n) return
  clearTimeout(n.timer)
  notices.value = notices.value.filter((x) => x.id !== id)
  n.onUndo?.()
}

export function useNotices() {
  return { notices, dismiss, undo, act }
}
