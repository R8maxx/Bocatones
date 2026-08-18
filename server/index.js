import { DatabaseSync } from 'node:sqlite'
import { randomUUID, randomInt } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import express from 'express'
import { WebSocketServer } from 'ws'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, 'bocatones.db')
const PORT = process.env.PORT || 3017

// cuánto se favorece a quien menos ha ido a por los bocatas:
// 0 = 100% aleatorio · 1 = suave · 2 = quien acaba de ir casi no entra
const FAIRNESS_EXP = 2
const WEIGHT_SCALE = 10000
// sorteos que se reenvían a un cliente que acaba de conectar (él filtra por su "hoy")
const DRAW_REPLAY = 7
// rango abierto para las consultas de histórico sin from/to
const DAY_MIN = '0000-01-01'
const DAY_MAX = '9999-12-31'

/* ----------------------------------------------------------------
   Base de datos (SQLite integrado en Node)
   ---------------------------------------------------------------- */
const db = new DatabaseSync(DB_PATH)
db.exec(`
  CREATE TABLE IF NOT EXISTS classics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    price_whole INTEGER,
    price_half  INTEGER,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id         TEXT PRIMARY KEY,
    day        TEXT NOT NULL,
    person     TEXT NOT NULL DEFAULT '',
    filling    TEXT NOT NULL,
    bread      TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    size       TEXT NOT NULL DEFAULT 'whole',
    price      INTEGER NOT NULL DEFAULT 0,
    paid       INTEGER NOT NULL DEFAULT 0,
    paid_at    INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_day ON orders(day);
  CREATE INDEX IF NOT EXISTS idx_orders_person ON orders(person COLLATE NOCASE);
  -- quién NO puede ir a por los bocatas un día concreto (reuniones, teletrabajo…)
  CREATE TABLE IF NOT EXISTS unavailable (
    day    TEXT NOT NULL,
    person TEXT NOT NULL COLLATE NOCASE,
    at     INTEGER NOT NULL,
    PRIMARY KEY (day, person)
  );
  -- un sorteo vigente por día: resortear reemplaza la fila
  CREATE TABLE IF NOT EXISTS draws (
    day     TEXT PRIMARY KEY,
    draw_id TEXT NOT NULL,
    winner  TEXT NOT NULL,
    people  TEXT NOT NULL DEFAULT '[]',
    odds    TEXT NOT NULL DEFAULT '[]',
    at      INTEGER NOT NULL
  );
`)

// migraciones para bases de datos creadas antes de estos campos
const addColumn = (table, name, def) => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`)
  } catch {
    /* la columna ya existe */
  }
}
addColumn('orders', 'size', "TEXT NOT NULL DEFAULT 'whole'")
addColumn('orders', 'price', 'INTEGER NOT NULL DEFAULT 0')
addColumn('orders', 'paid', 'INTEGER NOT NULL DEFAULT 0')
addColumn('orders', 'paid_at', 'INTEGER')
addColumn('classics', 'price_whole', 'INTEGER')
addColumn('classics', 'price_half', 'INTEGER')

// semilla de clásicos la primera vez
const SEED = ['Lomo con queso', 'Tortilla', 'Calamares', 'Jamón', 'Bacon con queso', 'Vegetal', 'Pollo']
const haveClassics = db.prepare('SELECT COUNT(*) AS n FROM classics').get().n
if (haveClassics === 0) {
  const ins = db.prepare('INSERT INTO classics (name, created_at) VALUES (?, ?)')
  const now = Date.now()
  for (const name of SEED) ins.run(name, now)
}

/* ----------------------------------------------------------------
   Consultas preparadas
   ---------------------------------------------------------------- */
const ORDER_COLS =
  'id, day, person, filling, bread, notes, size, price, paid, paid_at AS paidAt, created_at AS createdAt'
const CLASSIC_COLS = 'id, name, price_whole AS priceWhole, price_half AS priceHalf'
const DRAW_COLS = 'day, draw_id AS drawId, winner, people, odds, at'

const q = {
  // --- catálogo ---
  classics: db.prepare(`SELECT ${CLASSIC_COLS} FROM classics ORDER BY name COLLATE NOCASE ASC`),
  addClassic: db.prepare('INSERT OR IGNORE INTO classics (name, created_at) VALUES (?, ?)'),
  getClassic: db.prepare(`SELECT ${CLASSIC_COLS} FROM classics WHERE id = ?`),
  classicByName: db.prepare(`SELECT ${CLASSIC_COLS} FROM classics WHERE name = ? COLLATE NOCASE`),
  updateClassic: db.prepare('UPDATE classics SET name = ?, price_whole = ?, price_half = ? WHERE id = ?'),
  delClassic: db.prepare('DELETE FROM classics WHERE id = ?'),

  // --- pedidos ---
  ordersByDay: db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE day = ? ORDER BY created_at DESC`),
  addOrder: db.prepare(
    'INSERT INTO orders (id, day, person, filling, bread, notes, size, price, paid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ),
  getOrder: db.prepare(`SELECT ${ORDER_COLS} FROM orders WHERE id = ?`),
  updateOrder: db.prepare(
    'UPDATE orders SET person = ?, filling = ?, bread = ?, notes = ?, size = ?, price = ?, paid = ?, paid_at = ? WHERE id = ?',
  ),
  delOrder: db.prepare('DELETE FROM orders WHERE id = ?'),
  clearDay: db.prepare('DELETE FROM orders WHERE day = ?'),

  // --- pagos ---
  unpaidDays: db.prepare(
    "SELECT DISTINCT day FROM orders WHERE paid = 0 AND person = ? COLLATE NOCASE ORDER BY day DESC",
  ),
  settlePerson: db.prepare(
    'UPDATE orders SET paid = 1, paid_at = ? WHERE paid = 0 AND person = ? COLLATE NOCASE',
  ),
  settlePersonDay: db.prepare(
    'UPDATE orders SET paid = 1, paid_at = ? WHERE paid = 0 AND person = ? COLLATE NOCASE AND day = ?',
  ),

  // --- personas conocidas (grafía más reciente, gracias al MAX() de SQLite) ---
  people: db.prepare(
    "SELECT person AS name, MAX(created_at) AS lastAt FROM orders WHERE person <> '' GROUP BY LOWER(person) ORDER BY lastAt DESC",
  ),

  // --- ausencias del día ---
  unavailableOf: db.prepare('SELECT person FROM unavailable WHERE day = ?'),
  addUnavailable: db.prepare('INSERT OR IGNORE INTO unavailable (day, person, at) VALUES (?, ?, ?)'),
  delUnavailable: db.prepare('DELETE FROM unavailable WHERE day = ? AND person = ?'),

  // --- sorteos ---
  draw: db.prepare(`SELECT ${DRAW_COLS} FROM draws WHERE day = ?`),
  saveDraw: db.prepare(`
    INSERT INTO draws (day, draw_id, winner, people, odds, at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET
      draw_id = excluded.draw_id, winner = excluded.winner,
      people = excluded.people, odds = excluded.odds, at = excluded.at
  `),
  setDrawWinner: db.prepare('UPDATE draws SET winner = ? WHERE day = ?'),
  recentDraws: db.prepare(`SELECT ${DRAW_COLS} FROM draws ORDER BY day DESC LIMIT ?`),
  // veces que ha recogido cada persona, excluyendo un día (el que se está resorteando)
  tallyExcept: db.prepare(
    "SELECT LOWER(winner) AS key, COUNT(*) AS n FROM draws WHERE winner <> '' AND day <> ? GROUP BY LOWER(winner)",
  ),
  tallyRange: db.prepare(
    "SELECT LOWER(winner) AS key, COUNT(*) AS n FROM draws WHERE winner <> '' AND day BETWEEN ? AND ? GROUP BY LOWER(winner)",
  ),

  // --- histórico ---
  historyDays: db.prepare(`
    SELECT o.day AS day,
           COUNT(*) AS orders,
           COUNT(DISTINCT CASE WHEN o.person <> '' THEN LOWER(o.person) END) AS people,
           SUM(o.price) AS total,
           SUM(CASE WHEN o.paid = 0 THEN o.price ELSE 0 END) AS pending,
           d.winner AS winner
    FROM orders o
    LEFT JOIN draws d ON d.day = o.day
    WHERE o.day BETWEEN ? AND ?
    GROUP BY o.day
    ORDER BY o.day DESC
    LIMIT ?
  `),
  historyPeople: db.prepare(`
    SELECT person AS name,
           LOWER(person) AS key,
           COUNT(*) AS orders,
           COUNT(DISTINCT day) AS days,
           SUM(price) AS spent,
           SUM(CASE WHEN paid = 0 THEN price ELSE 0 END) AS pending,
           MAX(created_at) AS lastAt
    FROM orders
    WHERE person <> '' AND day BETWEEN ? AND ?
    GROUP BY LOWER(person)
  `),
  dayTotals: db.prepare(`
    SELECT COUNT(*) AS orders,
           SUM(price) AS total,
           SUM(CASE WHEN paid = 0 THEN price ELSE 0 END) AS pending
    FROM orders WHERE day = ?
  `),
}

/* ----------------------------------------------------------------
   Normalizadores
   ---------------------------------------------------------------- */
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const dayOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const sizeOf = (v) => (v === 'half' ? 'half' : 'whole') // entero por defecto
// dinero en céntimos: null si no es un número válido (para poder distinguir "no viene")
const cents = (v) => {
  if (v === null || v === '' || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}
const boolInt = (v) => (v === true || v === 1 || v === '1' ? 1 : 0)
const clampInt = (v, def, min, max) => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}
const safeJson = (txt, fallback) => {
  try {
    return JSON.parse(txt)
  } catch {
    return fallback
  }
}

// precio de catálogo de un relleno; la media es la mitad redondeada si no está definida
function catalogPrice(filling, size) {
  const row = q.classicByName.get(filling)
  if (!row) return null
  if (size === 'half') {
    if (row.priceHalf !== null) return row.priceHalf
    return row.priceWhole === null ? null : Math.round(row.priceWhole / 2)
  }
  return row.priceWhole
}

// personas únicas (no vacías, dedup ignorando mayúsculas) de los pedidos de un día
function peopleOf(day) {
  const seen = new Set()
  const names = []
  for (const o of q.ordersByDay.all(day)) {
    const name = str(o.person, 40)
    const key = name.toLowerCase()
    if (name && !seen.has(key)) {
      seen.add(key)
      names.push(name)
    }
  }
  return names
}

// baraja una copia (Fisher–Yates con randomInt) — mismo orden para todos
function shuffled(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/* ----------------------------------------------------------------
   Sorteo ponderado: quien menos ha ido tiene más papeletas
   ---------------------------------------------------------------- */

// papeletas de los candidatos de un día.
//
// Ojo con los dos recuentos, que NO son el mismo número:
//  - `weight`/`chance` se calculan EXCLUYENDO el sorteo del propio día, para no
//    penalizar al ganador que se va a reemplazar si se vuelve a sortear.
//  - `gone` es el total real (contando hoy), que es lo que se le muestra a la
//    gente para que cuadre con el resumen por persona.
function oddsFor(day) {
  const forDraw = new Map()
  for (const r of q.tallyExcept.all(day)) forDraw.set(r.key, r.n)
  const real = new Map()
  for (const r of q.tallyRange.all(DAY_MIN, DAY_MAX)) real.set(r.key, r.n)
  // quien no puede ir hoy se queda con 0 papeletas y fuera del reparto
  const away = new Set(q.unavailableOf.all(day).map((r) => r.person.toLowerCase()))

  const rows = peopleOf(day).map((name) => {
    const key = name.toLowerCase()
    const n = forDraw.get(key) || 0
    const available = !away.has(key)
    // nunca 0 si está disponible: todo el mundo conserva alguna papeleta
    const weight = available ? Math.max(1, Math.round(WEIGHT_SCALE / (n + 1) ** FAIRNESS_EXP)) : 0
    return { name, gone: real.get(key) || 0, available, weight }
  })
  const total = rows.reduce((s, r) => s + r.weight, 0)
  for (const r of rows) r.chance = total ? r.weight / total : 0
  // disponibles primero y de más a menos papeletas: se lee como un ranking
  rows.sort(
    (a, b) => Number(b.available) - Number(a.available) || b.weight - a.weight || a.name.localeCompare(b.name),
  )
  return {
    day,
    candidates: rows,
    total,
    available: rows.filter((r) => r.available).length,
    winner: q.draw.get(day)?.winner || null,
  }
}

// ojo: `rows` deben ser SOLO los candidatos disponibles (los ausentes pesan 0 y
// el respaldo del final del bucle podría caer en uno de ellos)
function pickWeighted(rows, total) {
  let t = randomInt(total)
  for (const r of rows) {
    t -= r.weight
    if (t < 0) return r.name
  }
  return rows[rows.length - 1].name
}

const drawPayload = (row) =>
  row && {
    type: 'draw',
    day: row.day,
    people: safeJson(row.people, []),
    odds: safeJson(row.odds, []),
    winner: row.winner,
    drawId: row.drawId,
    at: row.at,
  }

/* ----------------------------------------------------------------
   Tiempo real (WebSocket) — difunde cada cambio a todos los clientes
   ---------------------------------------------------------------- */
let wss = null
function broadcast(msg) {
  if (!wss) return
  const data = JSON.stringify(msg)
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(data)
  }
}
const pushOrders = (day, by) => broadcast({ type: 'orders', day, orders: q.ordersByDay.all(day), by })
const pushClassics = () => broadcast({ type: 'classics', classics: q.classics.all() })
const pushAway = (day) =>
  broadcast({ type: 'unavailable', day, people: q.unavailableOf.all(day).map((r) => r.person) })

/* ----------------------------------------------------------------
   API
   ---------------------------------------------------------------- */
const app = express()
app.use(express.json())

// --- clásicos (catálogo de rellenos + precios) ---
app.get('/api/classics', (_req, res) => {
  res.json(q.classics.all())
})

app.post('/api/classics', (req, res) => {
  const name = str(req.body?.name, 60)
  if (!name) return res.status(400).json({ error: 'nombre requerido' })
  q.addClassic.run(name, Date.now())
  pushClassics()
  res.status(201).json(q.classics.all())
})

app.put('/api/classics/:id', (req, res) => {
  const existing = q.getClassic.get(Number(req.params.id))
  if (!existing) return res.status(404).json({ error: 'no encontrado' })
  const b = req.body || {}
  const name = b.name === undefined ? existing.name : str(b.name, 60) || existing.name
  const priceWhole = b.priceWhole === undefined ? existing.priceWhole : cents(b.priceWhole)
  const priceHalf = b.priceHalf === undefined ? existing.priceHalf : cents(b.priceHalf)
  try {
    q.updateClassic.run(name, priceWhole, priceHalf, existing.id)
  } catch {
    return res.status(409).json({ error: 'ya existe un clásico con ese nombre' })
  }
  pushClassics()
  res.json(q.getClassic.get(existing.id))
})

app.delete('/api/classics/:id', (req, res) => {
  q.delClassic.run(Number(req.params.id))
  pushClassics()
  res.json(q.classics.all())
})

// --- personas conocidas (para autocompletar el nombre) ---
app.get('/api/people', (_req, res) => {
  res.json(q.people.all().map((r) => r.name))
})

// --- pedidos del día ---
app.get('/api/orders', (req, res) => {
  const day = dayOf(req.query.day)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  res.json(q.ordersByDay.all(day))
})

app.post('/api/orders', (req, res) => {
  const day = dayOf(req.body?.day)
  const filling = str(req.body?.filling, 60)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  if (!filling) return res.status(400).json({ error: 'relleno requerido' })
  const size = sizeOf(req.body?.size)
  // precio: el que llega; si no viene, el del catálogo; si tampoco, 0
  const price = cents(req.body?.price) ?? catalogPrice(filling, size) ?? 0
  const id = randomUUID()
  q.addOrder.run(
    id,
    day,
    str(req.body?.person, 40),
    filling,
    str(req.body?.bread, 40),
    str(req.body?.notes, 80),
    size,
    price,
    boolInt(req.body?.paid),
    Date.now(),
  )
  pushOrders(day, str(req.body?.clientId, 64))
  res.status(201).json(q.getOrder.get(id))
})

// actualización PARCIAL: solo se toca lo que llega en el body
app.put('/api/orders/:id', (req, res) => {
  const existing = q.getOrder.get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'no encontrado' })
  const b = req.body || {}
  const keep = (key, max) => (b[key] === undefined ? existing[key] : str(b[key], max))

  const filling = b.filling === undefined ? existing.filling : str(b.filling, 60) || existing.filling
  const size = b.size === undefined ? existing.size : sizeOf(b.size)
  const price = b.price === undefined ? existing.price : (cents(b.price) ?? existing.price)
  const paid = b.paid === undefined ? existing.paid : boolInt(b.paid)
  // conserva la marca de tiempo si ya estaba pagado; la borra si se desmarca
  const paidAt = paid ? existing.paidAt || Date.now() : null

  q.updateOrder.run(keep('person', 40), filling, keep('bread', 40), keep('notes', 80), size, price, paid, paidAt, req.params.id)
  pushOrders(existing.day, str(b.clientId, 64))
  res.json(q.getOrder.get(req.params.id))
})

app.delete('/api/orders/:id', (req, res) => {
  const existing = q.getOrder.get(req.params.id)
  q.delOrder.run(req.params.id)
  if (existing) pushOrders(existing.day, str(req.query.clientId, 64))
  res.json({ ok: true })
})

app.delete('/api/orders', (req, res) => {
  const day = dayOf(req.query.day)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  q.clearDay.run(day)
  pushOrders(day, str(req.query.clientId, 64))
  res.json({ ok: true })
})

// --- pagos: saldar todo lo que debe una persona (opcionalmente de un solo día) ---
app.post('/api/payments/settle', (req, res) => {
  const person = str(req.body?.person, 40)
  if (!person) return res.status(400).json({ error: 'persona requerida' })
  const day = req.body?.day === undefined || req.body.day === null ? null : dayOf(req.body.day)
  if (req.body?.day && !day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })

  const pending = q.unpaidDays.all(person).map((r) => r.day)
  const days = day ? pending.filter((d) => d === day) : pending
  const now = Date.now()
  if (day) q.settlePersonDay.run(now, person, day)
  else q.settlePerson.run(now, person)

  // los clientes refrescan el día que estén mirando si aparece en `days`
  broadcast({ type: 'paid', person, days, by: str(req.body?.clientId, 64) })
  res.json({ ok: true, days })
})

// --- ausencias: quién no puede ir hoy (queda fuera del sorteo) ---
app.get('/api/unavailable', (req, res) => {
  const day = dayOf(req.query.day)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  res.json(q.unavailableOf.all(day).map((r) => r.person))
})

app.put('/api/unavailable', (req, res) => {
  const day = dayOf(req.body?.day)
  const person = str(req.body?.person, 40)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  if (!person) return res.status(400).json({ error: 'persona requerida' })
  if (boolInt(req.body?.unavailable)) q.addUnavailable.run(day, person, Date.now())
  else q.delUnavailable.run(day, person)
  pushAway(day)
  res.json(oddsFor(day))
})

// --- sorteo: ¿quién recoge los bocatas hoy? ---
app.get('/api/draw/odds', (req, res) => {
  const day = dayOf(req.query.day)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  res.json(oddsFor(day))
})

app.post('/api/draw', (req, res) => {
  const day = dayOf(req.body?.day)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  const { candidates, total } = oddsFor(day)
  const pool = candidates.filter((c) => c.available) // los ausentes no entran en el bombo
  if (pool.length < 2) {
    return res.status(400).json({
      error:
        candidates.length < 2
          ? 'hacen falta al menos 2 personas para sortear'
          : 'hacen falta al menos 2 personas que puedan ir',
    })
  }
  const winner = pickWeighted(pool, total)
  const reel = shuffled(pool.map((c) => c.name)) // orden de los rodillos, idéntico para todos
  // guardamos también a los ausentes, para que el registro explique el reparto
  const odds = candidates.map((c) => ({ name: c.name, gone: c.gone, chance: c.chance, available: c.available }))
  const payload = { type: 'draw', day, people: reel, odds, winner, drawId: randomUUID(), at: Date.now() }
  q.saveDraw.run(day, payload.drawId, winner, JSON.stringify(reel), JSON.stringify(odds), payload.at)
  // announce: false => abrir la tragaperras y animar; el iniciador entra por aquí también
  broadcast({ ...payload, by: str(req.body?.clientId, 64) })
  res.json(payload)
})

// corregir a mano quién recogió de verdad (cuenta para las papeletas)
app.put('/api/draws/:day', (req, res) => {
  const day = dayOf(req.params.day)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  const winner = str(req.body?.winner, 40)
  if (!winner) return res.status(400).json({ error: 'ganador requerido' })
  if (q.draw.get(day)) q.setDrawWinner.run(winner, day)
  else q.saveDraw.run(day, randomUUID(), winner, JSON.stringify([winner]), '[]', Date.now())
  const payload = drawPayload(q.draw.get(day))
  // announce: true => solo actualiza el banner, sin reabrir la tragaperras
  broadcast({ ...payload, announce: true, by: str(req.body?.clientId, 64) })
  res.json(payload)
})

// --- histórico ---
app.get('/api/history/days', (req, res) => {
  const from = dayOf(req.query.from) || DAY_MIN
  const to = dayOf(req.query.to) || DAY_MAX
  const limit = clampInt(req.query.limit, 60, 1, 400)
  res.json(q.historyDays.all(from, to, limit))
})

app.get('/api/history/day', (req, res) => {
  const day = dayOf(req.query.day)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  const totals = q.dayTotals.get(day)
  res.json({
    day,
    orders: q.ordersByDay.all(day),
    draw: drawPayload(q.draw.get(day)) || null,
    totals: { orders: totals.orders || 0, total: totals.total || 0, pending: totals.pending || 0 },
  })
})

app.get('/api/history/people', (req, res) => {
  const from = dayOf(req.query.from) || DAY_MIN
  const to = dayOf(req.query.to) || DAY_MAX
  const gone = new Map()
  for (const r of q.tallyRange.all(from, to)) gone.set(r.key, r.n)

  const rows = q.historyPeople.all(from, to).map((r) => ({
    name: r.name,
    orders: r.orders,
    days: r.days,
    spent: r.spent || 0,
    pending: r.pending || 0,
    gone: gone.get(r.key) || 0,
  }))
  // primero quien más debe; a igualdad, quien más ha gastado
  rows.sort((a, b) => b.pending - a.pending || b.spent - a.spent || a.name.localeCompare(b.name))
  res.json(rows)
})

// --- servir el frontend compilado (producción) ---
const dist = join(__dirname, '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
}

const server = app.listen(PORT, () => {
  console.log(`🥪  bocatones API en http://localhost:${PORT}  (db: ${DB_PATH})`)
})

// WebSocket en /ws — al conectar enviamos el catálogo de clásicos de entrada
wss = new WebSocketServer({ server, path: '/ws' })
wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'classics', classics: q.classics.all() }))
  // reenvía los últimos sorteos con announce:true => el cliente muestra el ganador
  // en el menú sin volver a abrir/animar la tragaperras (filtra por su propio "hoy")
  for (const row of q.recentDraws.all(DRAW_REPLAY)) {
    socket.send(JSON.stringify({ ...drawPayload(row), announce: true }))
  }
})
