// pequeño cliente HTTP para la API de bocatones

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}))
    throw new Error(msg.error || `HTTP ${res.status}`)
  }
  return res.status === 204 ? null : res.json()
}

// identifica a ESTA pestaña/navegador para distinguir mis propios cambios
export const clientId =
  (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
  `c_${Date.now().toString(36)}`

// día local en formato YYYY-MM-DD (sin líos de zona horaria)
export function todayKey() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const api = {
  // clásicos
  listClassics: () => req('GET', '/api/classics'),
  addClassic: (name) => req('POST', '/api/classics', { name }),
  removeClassic: (id) => req('DELETE', `/api/classics/${id}`),

  // pedidos del día
  listOrders: (day) => req('GET', `/api/orders?day=${encodeURIComponent(day)}`),
  addOrder: (day, fields) => req('POST', '/api/orders', { day, clientId, ...fields }),
  updateOrder: (id, fields) => req('PUT', `/api/orders/${id}`, fields),
  removeOrder: (id) =>
    req('DELETE', `/api/orders/${id}?clientId=${encodeURIComponent(clientId)}`),
  clearDay: (day) =>
    req('DELETE', `/api/orders?day=${encodeURIComponent(day)}&clientId=${encodeURIComponent(clientId)}`),

  // sorteo: ¿quién recoge hoy? el servidor elige y lo difunde por WebSocket
  draw: (day) => req('POST', '/api/draw', { day, clientId }),
}