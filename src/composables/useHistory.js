import { ref, computed } from 'vue'
import { api, todayKey } from '../api.js'
import { onMessage } from '../realtime.js'

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
const loading = ref(false)
const error = ref(null)
let opened = false

async function loadDays() {
  days.value = await api.historyDays({ limit: 120 })
}
async function loadPeople() {
  people.value = await api.historyPeople()
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
  selectedDay.value = day
  dayDetail.value = day ? await api.historyDay(day) : null
}

// refresca lo que ya está cargado (tras un pago, un pedido nuevo, etc.)
async function reload() {
  if (!opened) return
  try {
    await Promise.all([loadDays(), loadPeople(), loadOdds()])
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
      await Promise.all([loadDays(), loadPeople(), loadOdds()])
      error.value = null
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
    if (first) {
      onMessage((msg) => {
        if (msg.type === 'orders' || msg.type === 'paid' || msg.type === 'draw' || msg.type === '__open') {
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
    loading.value = true
    try {
      await loadDetail(day)
      error.value = null
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  // marcar/desmarcar un pedido concreto desde el histórico
  async function setPaid(id, paid) {
    await api.updateOrder(id, { paid })
    await reload()
  }

  // saldar toda la cuenta de una persona (o solo la de un día)
  async function settle(person, day) {
    await api.settle(person, day)
    await reload()
  }

  // corregir a mano quién recogió de verdad ese día
  async function setWinner(day, winner) {
    await api.setDrawWinner(day, winner)
    await reload()
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
    totals,
    loading,
    error,
    load,
    select,
    setPaid,
    settle,
    setWinner,
    reload,
  }
}
