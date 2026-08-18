import { ref } from 'vue'
import { api, todayKey, clientId } from '../api.js'
import { onMessage } from '../realtime.js'

/*
 * useDraw — sorteo "¿quién recoge los bocatas hoy?" COMPARTIDO.
 *
 * El sorteo NO es uniforme: el servidor reparte papeletas según las veces que
 * ha ido cada uno (ver oddsFor en server/index.js). Aquí solo se muestran.
 *
 * Flujo:
 *  1. Quien lanza abre la máquina SOLO en su pantalla (openMachine) — sin sortear.
 *  2. Al tirar de la palanca (confirmDraw) el servidor elige el ganador y lo
 *     difunde por WebSocket: en ese momento la tragaperras aparece y gira en
 *     TODAS las pantallas con el mismo resultado.
 *
 *  - open   : ¿está la máquina abierta en MI pantalla?
 *  - round  : id de sesión (para remontar la máquina en cada nueva tirada).
 *  - draw   : sorteo resuelto { people, winner, odds, mine, ... } (null mientras se espera).
 *  - winner : ganador del día, persistente para el banner del menú normal.
 *  - odds   : papeletas de hoy, para enseñarlas ANTES de tirar de la palanca.
 *             Cada candidato trae `available`: quien no puede ir hoy (reuniones,
 *             etc.) va con 0 papeletas y no entra en el bombo.
 */

const open = ref(false)
const round = ref(0)
const draw = ref(null)
const winner = ref(null)
const odds = ref([])
let started = false

// papeletas actuales (para el ranking y la propia tragaperras)
async function loadOdds() {
  try {
    const res = await api.drawOdds(todayKey())
    odds.value = res.candidates
  } catch {
    odds.value = []
  }
}

function start() {
  if (started) return
  started = true

  onMessage((msg) => {
    // alguien ha marcado (o desmarcado) que no puede ir: recalcular papeletas
    if (msg.type === 'unavailable') {
      if (msg.day === todayKey()) loadOdds()
      return
    }
    if (msg.type !== 'draw' || msg.day !== todayKey()) return
    // el ganador del día se muestra siempre en el menú normal
    winner.value = { name: msg.winner, at: msg.at }
    if (msg.odds?.length) odds.value = msg.odds
    // announce:true => reenvío al (re)conectar o corrección manual del ganador:
    // solo banner, sin abrir la máquina
    if (msg.announce) return

    if (msg.by === clientId) {
      // soy quien tiró de la palanca: mi máquina ya está abierta esperando → recibe el resultado
      draw.value = { ...msg, mine: true }
    } else {
      // otra persona ha tirado: la máquina aparece y gira sola
      round.value++
      open.value = true
      draw.value = { ...msg, mine: false }
    }
  })
}

export function useDraw() {
  if (typeof window !== 'undefined') start()

  // marcar / desmarcar que alguien no puede ir hoy
  async function toggleAvailable(person) {
    const current = odds.value.find((o) => o.name === person)
    const res = await api.setUnavailable(todayKey(), person, current ? current.available : true)
    odds.value = res.candidates
  }

  // abre la máquina en MI pantalla (aún sin sortear); el resto no la ve todavía
  function openMachine() {
    round.value++
    draw.value = null
    open.value = true
    loadOdds() // así se ven las probabilidades antes de tirar
  }

  // tirar de la palanca → el servidor sortea y lo difunde a todos
  async function confirmDraw() {
    await api.draw(todayKey())
  }

  function closeDraw() {
    open.value = false
    draw.value = null
  }

  return { open, round, draw, winner, odds, openMachine, confirmDraw, closeDraw, loadOdds, toggleAvailable }
}
