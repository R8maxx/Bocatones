import { ref, computed } from 'vue'
import { api, todayKey, clientId } from '../api.js'
import { onMessage, startRealtime } from '../realtime.js'
import { fmt } from '../money.js'
import { notifyError, notifyOk, notifyUndo } from './useNotices.js'

/*
 * useOrders — lista del día COMPARTIDA, servida por el backend (SQLite).
 *
 * El servidor es la fuente de verdad. Los cambios llegan EN DIRECTO por
 * WebSocket; REST se usa para la carga inicial y como red de seguridad.
 *
 * Además de los pedidos de hoy lleva la DEUDA ACUMULADA por persona (todos los
 * días pendientes, no solo hoy), que viene del resumen del histórico.
 *
 * Todas las mutaciones avisan si fallan y deshacen su cambio optimista: antes
 * fallaban en silencio y se podía perder un pedido sin enterarse.
 */

const allOrders = ref([])
// ids ocultos localmente mientras corre el plazo de "deshacer". Se filtran
// aunque llegue un mensaje del WebSocket, para que la fila no reaparezca sola.
const hidden = ref(new Set())
const day = ref(todayKey())
const loading = ref(true)
const error = ref(null)
const freshIds = ref(new Set()) // pedidos recién llegados (para destacarlos)
const arrival = ref(null) // último pedido llegado de otra persona (para el aviso)
const debts = ref([]) // [{ name, pending, ... }] con pendiente > 0, de todos los días
let started = false
let ready = false // ya hemos cargado al menos una vez

const visible = computed(() => allOrders.value.filter((o) => !hidden.value.has(o.id)))

function hide(id) {
  const s = new Set(hidden.value)
  s.add(id)
  hidden.value = s
}
function unhide(id) {
  const s = new Set(hidden.value)
  s.delete(id)
  hidden.value = s
}

async function refresh() {
  try {
    // si ha cambiado el día (medianoche), apuntamos al nuevo
    const d = todayKey()
    if (d !== day.value) day.value = d
    allOrders.value = await api.listOrders(day.value)
    error.value = null
    ready = true
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// quién debe dinero, sumando todos los días sin pagar.
// se llama tras cada cambio, así que va agrupado para no encadenar peticiones.
let debtsTimer = null
function refreshDebts() {
  clearTimeout(debtsTimer)
  debtsTimer = setTimeout(async () => {
    try {
      const people = await api.historyPeople()
      debts.value = people.filter((p) => p.pending > 0)
    } catch {
      /* el panel de deuda simplemente no se muestra */
    }
  }, 200)
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
  refreshDebts()
  startRealtime()

  // cambios en directo del servidor
  onMessage((msg) => {
    if (msg.type === '__open') {
      refresh() // resincroniza al (re)conectar
      refreshDebts()
    } else if (msg.type === 'paid') {
      // alguien ha saldado una cuenta: puede afectar a días que no estoy mirando
      refreshDebts()
      if (msg.days?.includes(day.value)) refresh()
    } else if (msg.type === 'orders' && msg.day === day.value) {
      const prevList = allOrders.value
      const prevIds = new Set(prevList.map((o) => o.id))
      const incomingIds = new Set(msg.orders.map((o) => o.id))
      allOrders.value = msg.orders
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
      refreshDebts()
    }
  })

  // red de seguridad: refresco lento por si el WS estuviera caído
  // (y para detectar el cambio de día a medianoche)
  setInterval(refresh, 30000)
}

export function useOrders() {
  if (typeof window !== 'undefined') start()

  const count = computed(() => visible.value.length)

  // dinero del día: total pedido y lo que queda por cobrar
  const dayTotal = computed(() => visible.value.reduce((s, o) => s + (o.price || 0), 0))
  const dayPending = computed(() =>
    visible.value.reduce((s, o) => s + (o.paid ? 0 : o.price || 0), 0),
  )
  const dayPaidCount = computed(() => visible.value.filter((o) => o.paid).length)
  const debtTotal = computed(() => debts.value.reduce((s, d) => s + d.pending, 0))

  // agrupa los pedidos por relleno + pan + extras (conservando el texto original)
  function groupOrders() {
    const groups = new Map()
    for (const o of visible.value) {
      const filling = (o.filling || '???').trim()
      const bread = (o.bread || '').trim()
      const notes = (o.notes || '').trim()
      const key = [filling.toLowerCase(), bread.toLowerCase(), notes.toLowerCase()].join('|')
      let g = groups.get(key)
      if (!g) {
        g = { filling, bread, notes, whole: 0, half: 0, n: 0, money: 0 }
        groups.set(key, g)
      }
      if (o.size === 'half') g.half += 1
      else g.whole += 1
      g.n += 1
      g.money += o.price || 0
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

  // devuelve el pedido creado; lanza si falla, para que el formulario NO se vacíe
  async function addOrder(fields) {
    try {
      const created = await api.addOrder(day.value, fields)
      // alta optimista, pero evitando duplicar si el WS ya lo añadió
      if (!allOrders.value.some((o) => o.id === created.id)) {
        allOrders.value = [created, ...allOrders.value]
      }
      refreshDebts()
      return created
    } catch (e) {
      notifyError('No se ha podido añadir el pedido', e)
      throw e
    }
  }

  async function updateOrder(id, fields) {
    try {
      const updated = await api.updateOrder(id, fields)
      allOrders.value = allOrders.value.map((o) => (o.id === id ? updated : o))
      refreshDebts()
      return updated
    } catch (e) {
      notifyError('No se han podido guardar los cambios', e)
      throw e
    }
  }

  /*
   * Borrar con deshacer: la fila desaparece al instante pero el DELETE no se
   * envía hasta que se agota el plazo. Así el "deshacer" es de verdad gratis y
   * no hace falta un window.confirm para cada baja.
   */
  function removeOrder(id) {
    const gone = allOrders.value.find((o) => o.id === id)
    hide(id)
    notifyUndo(`Pedido de ${gone?.person || 'alguien'} eliminado`, {
      onUndo: () => unhide(id),
      onExpire: async () => {
        try {
          await api.removeOrder(id)
          unhide(id) // ya no está en el servidor: sobra el filtro local
          refreshDebts()
        } catch (e) {
          unhide(id) // vuelve a la lista: no se ha borrado
          notifyError('No se ha podido eliminar el pedido', e)
        }
      },
    })
  }

  async function clearAll() {
    const prev = allOrders.value
    allOrders.value = [] // optimista
    try {
      await api.clearDay(day.value)
      notifyOk('Pedido del día vaciado')
      refreshDebts()
    } catch (e) {
      allOrders.value = prev // rollback: antes se esperaban 30 s al refresco
      notifyError('No se ha podido vaciar el pedido', e)
    }
  }

  // marca como pagado todo lo que debe una persona (opcionalmente de un solo día)
  async function settle(person, onlyDay) {
    try {
      const res = await api.settle(person, onlyDay)
      notifyOk(`Cuenta de ${person} saldada`)
      refreshDebts()
      refresh()
      return res
    } catch (e) {
      notifyError(`No se ha podido saldar la cuenta de ${person}`, e)
      throw e
    }
  }

  // atajo para el check de la lista
  const setPaid = (id, paid) => updateOrder(id, { paid })

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
    let totalMoney = 0
    for (const g of rows) {
      totalWhole += g.whole
      totalHalf += g.half
      totalMoney += g.money
      const qty = []
      if (g.whole) qty.push(`${g.whole} ${g.whole === 1 ? 'entero' : 'enteros'}`)
      if (g.half) qty.push(`${g.half} ${g.half === 1 ? 'media' : 'medias'}`)
      let line = `${g.filling}: ${qty.join(' + ')}`
      const extra = []
      if (g.bread) extra.push(`pan: ${g.bread}`)
      if (g.notes) extra.push(g.notes)
      if (extra.length) line += ` — ${extra.join(', ')}`
      if (g.money) line += `  (${fmt(g.money)})`
      lines.push(line)
    }
    lines.push('='.repeat(30))
    const totals = []
    if (totalWhole) totals.push(`${totalWhole} ${totalWhole === 1 ? 'entero' : 'enteros'}`)
    if (totalHalf) totals.push(`${totalHalf} ${totalHalf === 1 ? 'media' : 'medias'}`)
    lines.push(`Total: ${totals.join(' + ') || '0'}`)
    if (totalMoney) lines.push(`A pagar: ${fmt(totalMoney)}`)
    return lines.join('\n')
  }

  return {
    orders: visible,
    day,
    count,
    byFilling,
    loading,
    error,
    freshIds,
    arrival,
    debts,
    debtTotal,
    dayTotal,
    dayPending,
    dayPaidCount,
    addOrder,
    updateOrder,
    removeOrder,
    setPaid,
    settle,
    clearAll,
    buildPlainList,
    refresh,
  }
}
