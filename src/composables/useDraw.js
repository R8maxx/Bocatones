import { ref } from 'vue'
import { api, todayKey, clientId } from '../api.js'
import { onMessage } from '../realtime.js'

/*
 * useDraw — sorteo "¿quién recoge los bocatas hoy?" COMPARTIDO.
 *
 * Flujo:
 *  1. Quien lanza abre la máquina SOLO en su pantalla (openMachine) — sin sortear.
 *  2. Al tirar de la palanca (confirmDraw) el servidor elige el ganador y lo
 *     difunde por WebSocket: en ese momento la tragaperras aparece y gira en
 *     TODAS las pantallas con el mismo resultado.
 *
 *  - open   : ¿está la máquina abierta en MI pantalla?
 *  - round  : id de sesión (para remontar la máquina en cada nueva tirada).
 *  - draw   : sorteo resuelto { people, winner, mine, ... } (null mientras se espera).
 *  - winner : ganador del día, persistente para el banner del menú normal.
 */

const open = ref(false)
const round = ref(0)
const draw = ref(null)
const winner = ref(null)
let started = false

function start() {
  if (started) return
  started = true

  onMessage((msg) => {
    if (msg.type !== 'draw' || msg.day !== todayKey()) return
    // el ganador del día se muestra siempre en el menú normal
    winner.value = { name: msg.winner, at: msg.at }
    // announce:true => reenvío al (re)conectar: solo banner, sin abrir la máquina
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

  // abre la máquina en MI pantalla (aún sin sortear); el resto no la ve todavía
  function openMachine() {
    round.value++
    draw.value = null
    open.value = true
  }

  // tirar de la palanca → el servidor sortea y lo difunde a todos
  async function confirmDraw() {
    await api.draw(todayKey())
  }

  function closeDraw() {
    open.value = false
    draw.value = null
  }

  return { open, round, draw, winner, openMachine, confirmDraw, closeDraw }
}