import { ref } from 'vue'
import { api } from '../api.js'
import { onMessage, startRealtime } from '../realtime.js'

/*
 * useClassics — catálogo de bocadillos clásicos (compartido, en el backend).
 * Cualquiera puede añadir y borrar. Llega y se actualiza en directo por WebSocket.
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

export function useClassics() {
  if (typeof window !== 'undefined') start()

  async function addClassic(name) {
    if (!name || !name.trim()) return
    classics.value = await api.addClassic(name.trim())
  }

  async function removeClassic(id) {
    classics.value = await api.removeClassic(id)
  }

  return { classics, addClassic, removeClassic, refresh }
}