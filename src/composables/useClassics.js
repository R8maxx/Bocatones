import { ref } from 'vue'
import { api } from '../api.js'
import { onMessage, startRealtime } from '../realtime.js'

/*
 * useClassics — catálogo de bocadillos clásicos (compartido, en el backend).
 * Cualquiera puede añadir, borrar y ponerle precio. Llega y se actualiza en
 * directo por WebSocket.
 *
 * Los precios van en céntimos. `priceHalf` a null significa "la mitad del
 * entero, redondeada" — el servidor aplica la misma regla al crear el pedido.
 */

const classics = ref([])
let started = false

async function refresh() {
  try {
    classics.value = await api.listClassics()
  } catch {
    /* el formulario funciona igual sin sugerencias */
  }
}

function start() {
  if (started) return
  started = true
  refresh()
  startRealtime()
  onMessage((msg) => {
    if (msg.type === 'classics') classics.value = msg.classics
  })
}

// precio de catálogo de un relleno para un tamaño, o null si no hay
export function catalogPrice(list, filling, size) {
  const name = (filling || '').trim().toLowerCase()
  if (!name) return null
  const c = list.find((x) => x.name.toLowerCase() === name)
  if (!c) return null
  if (size === 'half') {
    if (c.priceHalf !== null && c.priceHalf !== undefined) return c.priceHalf
    return c.priceWhole === null || c.priceWhole === undefined ? null : Math.round(c.priceWhole / 2)
  }
  return c.priceWhole ?? null
}

export function useClassics() {
  if (typeof window !== 'undefined') start()

  async function addClassic(name) {
    if (!name || !name.trim()) return
    classics.value = await api.addClassic(name.trim())
  }

  async function updateClassic(id, fields) {
    const updated = await api.updateClassic(id, fields)
    classics.value = classics.value.map((c) => (c.id === id ? updated : c))
  }

  async function removeClassic(id) {
    classics.value = await api.removeClassic(id)
  }

  // precio sugerido para el relleno/tamaño que hay escrito ahora mismo
  function priceFor(filling, size) {
    return catalogPrice(classics.value, filling, size)
  }

  return { classics, addClassic, updateClassic, removeClassic, priceFor, refresh }
}
