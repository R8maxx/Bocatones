import { ref, computed } from 'vue'
import { api, todayKey, clientId } from '../api.js'
import { onMessage, startRealtime } from '../realtime.js'

/*
 * useOrders — lista del día COMPARTIDA, servida por el backend (SQLite).
 *
 * El servidor es la fuente de verdad. Los cambios llegan EN DIRECTO por
 * WebSocket; REST se usa para la carga inicial y como red de seguridad.
 */

const orders = ref([])
const day = ref(todayKey())
const loading = ref(true)
const error = ref(null)
const freshIds = ref(new Set()) // pedidos recién llegados (para destacarlos)
const arrival = ref(null) // último pedido llegado de otra persona (para el aviso)
let started = false
let ready = false // ya hemos cargado al menos una vez

async function refresh() {
  try {
    // si ha cambiado el día (medianoche), apuntamos al nuevo
    const d = todayKey()
    if (d !== day.value) day.value = d
    orders.value = await api.listOrders(day.value)
    error.value = null
    ready = true
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// marca como "frescos" los pedidos nuevos y dispara el aviso del más reciente
function flashArrivals(newOnes) {
  const s = new Set(freshIds.value)
  newOnes.forEach((o) => s.add(o.id))
  freshIds.value = s

  const top = newOnes[0]
  arrival.value = {
    kind: 'add',
    id: top.id,
    person: top.person,
    filling: top.filling,
    count: newOnes.length,
    at: Date.now(),
  }

  // quita el destello cuando termina la animación
  newOnes.forEach((o) => {
    setTimeout(() => {
      const ns = new Set(freshIds.value)
      ns.delete(o.id)
      freshIds.value = ns
    }, 2600)
  })
}

// aviso cuando alguien elimina pedidos (ya no están en la lista)
function flashDepartures(removed) {
  const top = removed[0]
  arrival.value = {
    kind: 'remove',
    id: 'rm_' + top.id,
    person: top.person,
    filling: top.filling,
    count: removed.length,
    at: Date.now(),
  }
}

function start() {
  if (started) return
  started = true
  refresh()
  startRealtime()

  // cambios en directo del servidor
  onMessage((msg) => {
    if (msg.type === '__open') {
      refresh() // resincroniza al (re)conectar
    } else if (msg.type === 'orders' && msg.day === day.value) {
      const prevList = orders.value
      const prevIds = new Set(prevList.map((o) => o.id))
      const incomingIds = new Set(msg.orders.map((o) => o.id))
      orders.value = msg.orders
      loading.value = false
      error.value = null
      // solo avisamos si ya habíamos cargado y el cambio NO lo hice yo
      if (ready && msg.by !== clientId) {
        const added = msg.orders.filter((o) => !prevIds.has(o.id))
        if (added.length) flashArrivals(added)
        const removed = prevList.filter((o) => !incomingIds.has(o.id))
        if (removed.length) flashDepartures(removed)
      }
      ready = true
    }
  })

  // red de seguridad: refresco lento por si el WS estuviera caído
  // (y para detectar el cambio de día a medianoche)
  setInterval(refresh, 30000)
}

export function useOrders() {
  if (typeof window !== 'undefined') start()

  const count = computed(() => orders.value.length)

  const byFilling = computed(() => {
    const tally = new Map()
    for (const o of orders.value) {
      const label = (o.filling || '???').trim()
      const key = label.toLowerCase()
      const prev = tally.get(key)
      if (prev) prev.n += 1
      else tally.set(key, { name: label, n: 1 })
    }
    return [...tally.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
  })

  async function addOrder(fields) {
    const created = await api.addOrder(day.value, fields)
    // alta optimista, pero evitando duplicar si el WS ya lo añadió
    if (!orders.value.some((o) => o.id === created.id)) {
      orders.value = [created, ...orders.value]
    }
  }

  async function updateOrder(id, fields) {
    const updated = await api.updateOrder(id, fields)
    orders.value = orders.value.map((o) => (o.id === id ? updated : o))
  }

  async function removeOrder(id) {
    orders.value = orders.value.filter((o) => o.id !== id) // optimista
    await api.removeOrder(id)
  }

  async function clearAll() {
    orders.value = []
    await api.clearDay(day.value)
  }

  function buildPlainList(dateLabel) {
    const lines = []
    lines.push(`PEDIDO BOCATAS${dateLabel ? ' - ' + dateLabel : ''}`)
    lines.push('='.repeat(30))
    for (const b of byFilling.value) lines.push(`${b.n}x ${b.name}`)
    lines.push('='.repeat(30))
    lines.push(`Total: ${orders.value.length} ${orders.value.length === 1 ? 'bocata' : 'bocatas'}`)
    return lines.join('\n')
  }

  return {
    orders,
    count,
    byFilling,
    loading,
    error,
    freshIds,
    arrival,
    addOrder,
    updateOrder,
    removeOrder,
    clearAll,
    buildPlainList,
    refresh,
  }
}