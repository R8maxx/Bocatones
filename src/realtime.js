import { ref } from 'vue'

/*
 * realtime — un único WebSocket compartido por toda la app.
 * Reconecta solo y avisa a los suscriptores de cada mensaje del servidor.
 * Emite un mensaje sintético { type: '__open' } al (re)conectar para que
 * los composables puedan resincronizarse vía REST.
 */

export const rtStatus = ref('connecting') // connecting | online | offline

const listeners = new Set()
let socket = null
let reconnectTimer = null
let backoff = 1000

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

function emit(msg) {
  for (const fn of listeners) {
    try {
      fn(msg)
    } catch {
      /* un suscriptor con error no debe tumbar al resto */
    }
  }
}

function connect() {
  clearTimeout(reconnectTimer)
  try {
    socket = new WebSocket(wsUrl())
  } catch {
    scheduleReconnect()
    return
  }

  socket.onopen = () => {
    rtStatus.value = 'online'
    backoff = 1000
    emit({ type: '__open' })
  }
  socket.onmessage = (e) => {
    let msg
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }
    emit(msg)
  }
  socket.onclose = () => {
    rtStatus.value = 'offline'
    scheduleReconnect()
  }
  socket.onerror = () => {
    try {
      socket.close()
    } catch {
      /* ignore */
    }
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(connect, backoff)
  backoff = Math.min(backoff * 1.6, 10000) // backoff exponencial hasta 10s
}

export function startRealtime() {
  if (socket) return
  connect()
}

export function onMessage(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}