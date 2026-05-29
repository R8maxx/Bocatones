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
    size: top.size,
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
    size: top.size,
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

  // agrupa los pedidos por relleno + pan + extras (conservando el texto original)
  function groupOrders() {
    const groups = new Map()
    for (const o of orders.value) {
      const filling = (o.filling || '???').trim()
      const bread = (o.bread || '').trim()
      const notes = (o.notes || '').trim()
      const key = [filling.toLowerCase(), bread.toLowerCase(), notes.toLowerCase()].join('|')
      let g = groups.get(key)
      if (!g) {
        g = { filling, bread, notes, whole: 0, half: 0, n: 0 }
        groups.set(key, g)
      }
      if (o.size === 'half') g.half += 1
      else g.whole += 1
      g.n += 1
    }
    return [...groups.values()]
  }

  // recuento para el panel: de más a menos pedido
  const byFilling = computed(() =>
    groupOrders().sort(
      (a, b) =>
        b.n - a.n ||
        a.filling.localeCompare(b.filling) ||
        a.bread.localeCompare(b.bread) ||
        a.notes.localeCompare(b.notes),
    ),
  )

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
    // mismo agrupado que el panel, pero ordenado alfabéticamente para leerlo
    const rows = groupOrders().sort(
      (a, b) =>
        a.filling.localeCompare(b.filling) ||
        a.bread.localeCompare(b.bread) ||
        a.notes.localeCompare(b.notes),
    )

    const lines = []
    lines.push(`PEDIDO BOCATAS${dateLabel ? ' - ' + dateLabel : ''}`)
    lines.push('='.repeat(30))
    let totalWhole = 0
    let totalHalf = 0
    for (const g of rows) {
      totalWhole += g.whole
      totalHalf += g.half
      const qty = []
      if (g.whole) qty.push(`${g.whole} ${g.whole === 1 ? 'entero' : 'enteros'}`)
      if (g.half) qty.push(`${g.half} ${g.half === 1 ? 'media' : 'medias'}`)
      let line = `${g.filling}: ${qty.join(' + ')}`
      const extra = []
      if (g.bread) extra.push(`pan: ${g.bread}`)
      if (g.notes) extra.push(g.notes)
      if (extra.length) line += ` — ${extra.join(', ')}`
      lines.push(line)
    }
    lines.push('='.repeat(30))
    const totals = []
    if (totalWhole) totals.push(`${totalWhole} ${totalWhole === 1 ? 'entero' : 'enteros'}`)
    if (totalHalf) totals.push(`${totalHalf} ${totalHalf === 1 ? 'media' : 'medias'}`)
    lines.push(`Total: ${totals.join(' + ') || '0'}`)
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