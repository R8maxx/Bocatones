import { ref, computed } from 'vue'
import { api, todayKey } from '../api.js'
import { onMessage } from '../realtime.js'
import { notifyError, notifyOk } from './useNotices.js'

/*
 * useHistory — modo histórico: días anteriores, resumen por persona y ranking
 * de "a quién le toca".
 *
 * Carga PEREZOSA: no pide nada hasta que se entra en el histórico (load()).
 * A partir de ahí se resincroniza con los cambios que llegan por WebSocket.
 */

const days = ref([]) // [{ day, orders, people, total, pending, winner }]
const selectedDay = ref(null)
const dayDetail = ref(null) // { day, orders, draw, totals }
const people = ref([]) // [{ name, orders, days, spent, pending, gone }]
const odds = ref(null) // { day, candidates, total } — papeletas de HOY
const debts = ref([]) // pares deudor→acreedor, para anotar a quién se le debe
const ready = ref(false) // ya se ha cargado al menos una vez (para no mentir en los vacíos)
const detailLoading = ref(false) // cargando el detalle de un día concreto
const loading = ref(true) // arranca cargando: ver ready
const error = ref(null)
let opened = false

async function loadDays() {
  days.value = await api.historyDays({ limit: 120 })
}
async function loadPeople() {
  people.value = await api.historyPeople()
}
async function loadDebts() {
  debts.value = (await api.debts()).rows
}
async function loadOdds() {
  try {
    odds.value = await api.drawOdds(todayKey())
  } catch {
    // hoy puede no tener candidatos todavía; el ranking simplemente no se muestra
    odds.value = null
  }
}

async function loadDetail(day) {
  // el detalle se limpia ANTES del await: si no, la fila nueva se despliega
  // mostrando los pedidos del día anterior mientras llega la respuesta
  if (selectedDay.value !== day) dayDetail.value = null
  selectedDay.value = day
  dayDetail.value = day ? await api.historyDay(day) : null
}

// refresca lo que ya está cargado (tras un pago, un pedido nuevo, etc.)
async function reload() {
  if (!opened) return
  try {
    await Promise.all([loadDays(), loadPeople(), loadOdds(), loadDebts()])
    if (selectedDay.value) await loadDetail(selectedDay.value)
    error.value = null
  } catch (e) {
    error.value = e.message
  }
}

export function useHistory() {
  // primera entrada al histórico: engancha el refresco en directo
  async function load() {
    const first = !opened
    opened = true
    loading.value = true
    try {
      await Promise.all([loadDays(), loadPeople(), loadOdds(), loadDebts()])
      error.value = null
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
    ready.value = true
    if (first) {
      onMessage((msg) => {
        if (
          msg.type === 'orders' ||
          msg.type === 'paid' ||
          msg.type === 'draw' ||
          msg.type === 'payer' ||
          msg.type === '__open'
        ) {
          reload()
        }
      })
    }
  }

  async function select(day) {
    if (selectedDay.value === day) {
      selectedDay.value = null
      dayDetail.value = null
      return
    }
    detailLoading.value = true
    try {
      await loadDetail(day)
      error.value = null
    } catch (e) {
      error.value = e.message
    } finally {
      detailLoading.value = false
    }
  }

  // marcar/desmarcar un pedido concreto desde el histórico
  async function setPaid(id, paid) {
    try {
      await api.updateOrder(id, { paid })
      await reload()
    } catch (e) {
      notifyError('No se ha podido cambiar el estado de pago', e)
    }
  }

  // a quién le debe una persona (solo para anotar la fila; el dinero lo suma el
  // servidor). Aquí sí vale toLowerCase(): compara contra una clave que ya vino
  // de SQL y no agrupa dinero.
  const creditorsOf = (name) =>
    debts.value.filter((r) => r.kind === 'pair' && r.debtorKey === (name || '').toLowerCase())

  // saldar toda la cuenta de una persona (o solo la de un día)
  async function settle(person, day) {
    try {
      await api.settle(person, day)
      notifyOk(`Cuenta de ${person} saldada`)
      await reload()
    } catch (e) {
      notifyError(`No se ha podido saldar la cuenta de ${person}`, e)
    }
  }

  // corregir a mano quién recogió de verdad ese día
  async function setWinner(day, winner) {
    try {
      await api.setDrawWinner(day, winner)
      notifyOk(`Corregido: recogió ${winner}`)
      await reload()
    } catch (e) {
      notifyError('No se ha podido corregir quién recogió', e)
    }
  }

  // corregir quién puso el dinero ese día (vacío = seguir a quien recogió)
  async function setPayer(day, person) {
    try {
      const res = await api.setPayer(day, person)
      if (!person) notifyOk('Ese día vuelve a pagar quien recogió')
      else if (res.settled) notifyOk(`Ese día pagó ${res.payer} — ${res.settled} pedidos ya pagados no cambian de acreedor`)
      else notifyOk(`Ese día pagó ${res.payer}`)
      await reload()
    } catch (e) {
      notifyError('No se ha podido cambiar quién pagó', e)
    }
  }

  const totals = computed(() =>
    days.value.reduce(
      (acc, d) => ({
        orders: acc.orders + d.orders,
        total: acc.total + (d.total || 0),
        pending: acc.pending + (d.pending || 0),
      }),
      { orders: 0, total: 0, pending: 0 },
    ),
  )

  return {
    days,
    selectedDay,
    dayDetail,
    people,
    odds,
    debts,
    creditorsOf,
    totals,
    loading,
    detailLoading,
    ready,
    error,
    load,
    select,
    setPaid,
    settle,
    setWinner,
    setPayer,
    reload,
  }
}
