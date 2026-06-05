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

/* ----------------------------------------------------------------
   Base de datos (SQLite integrado en Node)
   ---------------------------------------------------------------- */
const db = new DatabaseSync(DB_PATH)
db.exec(`
  CREATE TABLE IF NOT EXISTS classics (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id         TEXT PRIMARY KEY,
    day        TEXT NOT NULL,
    person     TEXT NOT NULL DEFAULT '',
    filling    TEXT NOT NULL,
    bread      TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    size       TEXT NOT NULL DEFAULT 'whole',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_day ON orders(day);
`)

// migración para bases de datos creadas antes del campo "size"
try {
  db.exec("ALTER TABLE orders ADD COLUMN size TEXT NOT NULL DEFAULT 'whole'")
} catch {
  /* la columna ya existe */
}

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
const q = {
  classics: db.prepare('SELECT id, name FROM classics ORDER BY name COLLATE NOCASE ASC'),
  addClassic: db.prepare('INSERT OR IGNORE INTO classics (name, created_at) VALUES (?, ?)'),
  delClassic: db.prepare('DELETE FROM classics WHERE id = ?'),
  ordersByDay: db.prepare(
    'SELECT id, person, filling, bread, notes, size, created_at AS createdAt FROM orders WHERE day = ? ORDER BY created_at DESC',
  ),
  addOrder: db.prepare(
    'INSERT INTO orders (id, day, person, filling, bread, notes, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ),
  getOrder: db.prepare('SELECT id, person, filling, bread, notes, size, created_at AS createdAt FROM orders WHERE id = ?'),
  dayOfOrder: db.prepare('SELECT day FROM orders WHERE id = ?'),
  updateOrder: db.prepare('UPDATE orders SET person = ?, filling = ?, bread = ?, notes = ?, size = ? WHERE id = ?'),
  delOrder: db.prepare('DELETE FROM orders WHERE id = ?'),
  clearDay: db.prepare('DELETE FROM orders WHERE day = ?'),
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const dayOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const sizeOf = (v) => (v === 'half' ? 'half' : 'whole') // entero por defecto

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

// último sorteo por día: { day, people, winner, drawId, at } — en memoria
const draws = new Map()

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

/* ----------------------------------------------------------------
   API
   ---------------------------------------------------------------- */
const app = express()
app.use(express.json())

// --- clásicos ---
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

app.delete('/api/classics/:id', (req, res) => {
  q.delClassic.run(Number(req.params.id))
  pushClassics()
  res.json(q.classics.all())
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
  const id = randomUUID()
  q.addOrder.run(
    id,
    day,
    str(req.body?.person, 40),
    filling,
    str(req.body?.bread, 40),
    str(req.body?.notes, 80),
    sizeOf(req.body?.size),
    Date.now(),
  )
  pushOrders(day, str(req.body?.clientId, 64))
  res.status(201).json(q.getOrder.get(id))
})

app.put('/api/orders/:id', (req, res) => {
  const existing = q.getOrder.get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'no encontrado' })
  const filling = str(req.body?.filling, 60) || existing.filling
  const size = req.body?.size === undefined ? existing.size : sizeOf(req.body.size)
  q.updateOrder.run(
    str(req.body?.person, 40),
    filling,
    str(req.body?.bread, 40),
    str(req.body?.notes, 80),
    size,
    req.params.id,
  )
  const updated = q.getOrder.get(req.params.id)
  const row = q.dayOfOrder.get(req.params.id)
  if (row) pushOrders(row.day)
  res.json(updated)
})

app.delete('/api/orders/:id', (req, res) => {
  const row = q.dayOfOrder.get(req.params.id)
  q.delOrder.run(req.params.id)
  if (row) pushOrders(row.day, str(req.query.clientId, 64))
  res.json({ ok: true })
})

app.delete('/api/orders', (req, res) => {
  const day = dayOf(req.query.day)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  q.clearDay.run(day)
  pushOrders(day, str(req.query.clientId, 64))
  res.json({ ok: true })
})

// --- sorteo: ¿quién recoge los bocatas hoy? ---
app.post('/api/draw', (req, res) => {
  const day = dayOf(req.body?.day)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  const people = peopleOf(day)
  if (people.length < 2) {
    return res.status(400).json({ error: 'hacen falta al menos 2 personas para sortear' })
  }
  const reel = shuffled(people) // orden de los rodillos, idéntico para todos
  const winner = reel[randomInt(reel.length)]
  const payload = { type: 'draw', day, people: reel, winner, drawId: randomUUID(), at: Date.now() }
  draws.set(day, payload)
  // announce: false => abrir la tragaperras y animar; el iniciador entra por aquí también
  broadcast({ ...payload, by: str(req.body?.clientId, 64) })
  res.json(payload)
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
  // reenvía los sorteos ya hechos con announce:true => el cliente muestra el
  // ganador en el menú sin volver a abrir/animar la tragaperras
  for (const payload of draws.values()) {
    socket.send(JSON.stringify({ ...payload, announce: true }))
  }
})