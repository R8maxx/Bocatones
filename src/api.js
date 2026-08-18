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

const qs = (params) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v)
  const out = s.toString()
  return out ? `?${out}` : ''
}

export const api = {
  // clásicos (catálogo de rellenos + precios)
  listClassics: () => req('GET', '/api/classics'),
  addClassic: (name) => req('POST', '/api/classics', { name }),
  updateClassic: (id, fields) => req('PUT', `/api/classics/${id}`, fields),
  removeClassic: (id) => req('DELETE', `/api/classics/${id}`),

  // personas ya conocidas, para autocompletar el nombre
  listPeople: () => req('GET', '/api/people'),

  // pedidos del día
  listOrders: (day) => req('GET', `/api/orders${qs({ day })}`),
  addOrder: (day, fields) => req('POST', '/api/orders', { day, clientId, ...fields }),
  updateOrder: (id, fields) => req('PUT', `/api/orders/${id}`, { clientId, ...fields }),
  removeOrder: (id) => req('DELETE', `/api/orders/${id}${qs({ clientId })}`),
  clearDay: (day) => req('DELETE', `/api/orders${qs({ day, clientId })}`),

  // pagos: saldar todo lo que debe una persona (o solo un día)
  settle: (person, day) => req('POST', '/api/payments/settle', { person, day, clientId }),

  // ausencias: quién no puede ir hoy (queda fuera del sorteo)
  listUnavailable: (day) => req('GET', `/api/unavailable${qs({ day })}`),
  setUnavailable: (day, person, unavailable) =>
    req('PUT', '/api/unavailable', { day, person, unavailable, clientId }),

  // sorteo: ¿quién recoge hoy? el servidor elige y lo difunde por WebSocket
  draw: (day) => req('POST', '/api/draw', { day, clientId }),
  drawOdds: (day) => req('GET', `/api/draw/odds${qs({ day })}`),
  setDrawWinner: (day, winner) => req('PUT', `/api/draws/${day}`, { winner, clientId }),

  // histórico
  historyDays: (params = {}) => req('GET', `/api/history/days${qs(params)}`),
  historyDay: (day) => req('GET', `/api/history/day${qs({ day })}`),
  historyPeople: (params = {}) => req('GET', `/api/history/people${qs(params)}`),
}
