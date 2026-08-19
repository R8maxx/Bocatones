import { ref } from 'vue'
import { api, todayKey } from '../api.js'
import { onMessage } from '../realtime.js'
import { notifyError, notifyOk } from './useNotices.js'

/*
 * usePayer — quién PUSO EL DINERO hoy, o sea a quién se le debe.
 *
 * Por defecto es quien recogió (el ganador del sorteo), así que un sorteo nuevo
 * o una corrección del ganador lo cambian solos: el mensaje 'draw' ya trae el
 * pagador efectivo calculado por el servidor.
 *
 * Si alguien lo fija a mano (source: 'manual') deja de seguir al sorteo hasta
 * que se suelte (elegir la opción vacía). Eso se DICE en la interfaz: si no,
 * corriges el ganador, ves que el pagador no cambia y parece un fallo.
 */

const payer = ref(null) // { name, source } | null → null = hoy no hay pagador
const settled = ref(0) // pedidos de hoy ya pagados (para avisar al cambiar)
let started = false

// los mensajes 'payer' traen `source`; los 'draw', `payerSource`
function apply(msg) {
  payer.value = msg.payer
    ? { name: msg.payer, source: msg.source || msg.payerSource || null }
    : null
  if (typeof msg.settled === 'number') settled.value = msg.settled
}

async function load() {
  try {
    apply(await api.getPayer(todayKey()))
  } catch {
    /* sin pagador la tarjeta simplemente no lo muestra */
  }
}

function start() {
  if (started) return
  started = true
  load()
  onMessage((msg) => {
    if (msg.type === '__open') load()
    else if ((msg.type === 'payer' || msg.type === 'draw') && msg.day === todayKey()) apply(msg)
  })
}

export function usePayer() {
  if (typeof window !== 'undefined') start()

  // nombre vacío = quitar la corrección y volver a seguir al sorteo
  async function setPayer(name) {
    try {
      const res = await api.setPayer(todayKey(), name)
      apply(res)
      if (!name) {
        notifyOk('El pagador vuelve a ser quien recoja')
      } else if (res.auto) {
        notifyOk(`Hoy paga ${res.payer} — sus bocatas quedan pagados`)
      } else {
        notifyOk(`Hoy paga ${res.payer}`)
      }
    } catch (e) {
      notifyError('No se ha podido cambiar quién pone el dinero', e)
    }
  }

  return { payer, settled, setPayer, load }
}
