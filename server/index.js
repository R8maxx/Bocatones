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
  -- quién PUSO EL DINERO un día: el acreedor de la deuda de esa jornada.
  -- Aquí solo viven las correcciones A MANO. Si un día no está en esta tabla,
  -- paga quien recogió (draws.winner), así que el histórico entero ya tiene
  -- pagador sin migrar ni una fila. Borrar la fila = volver a seguir al sorteo.
  CREATE TABLE IF NOT EXISTS payers (
    day    TEXT PRIMARY KEY,
    person TEXT NOT NULL COLLATE NOCASE,
    at     INTEGER NOT NULL
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
// Marca de "pagado automáticamente por poner el dinero ese día", en tres
// estados, para que la automatización nunca pise a una persona:
//   0 = nada automático (pagado o pendiente a mano, lo normal)
//   1 = lo marcó el pagador automáticamente (deshacible si cambia el pagador)
//   2 = alguien lo DESMARCÓ a mano: no se vuelve a marcar solo nunca más
addColumn('orders', 'paid_auto', 'INTEGER NOT NULL DEFAULT 0')
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
  'id, day, person, filling, bread, notes, size, price, paid, paid_at AS paidAt, paid_auto AS paidAuto, created_at AS createdAt'
const CLASSIC_COLS = 'id, name, price_whole AS priceWhole, price_half AS priceHalf'
const DRAW_COLS = 'day, draw_id AS drawId, winner, people, odds, at'

/*
 * «Pagador efectivo» de cada día, definido UNA vez y reutilizado (mismo truco
 * que ORDER_COLS: un trozo de SQL interpolado, no una vista, para no añadir un
 * objeto de esquema que habría que recrear en cada arranque).
 *
 * La regla: manda la corrección a mano; si no hay, paga quien recogió. Por eso
 * el histórico ya tiene acreedor sin tocar datos, y por eso corregir el ganador
 * de un día arrastra al pagador MIENTRAS nadie lo haya fijado.
 *
 * Los NULLIF están a propósito: una fila de draws con winner = '' (que tampoco
 * cuenta papeletas) no puede ser acreedor. `person` sale NULL en un día
 * conocido y sin pagador.
 */
const DAY_PAYER = `
  SELECT t.day AS day,
         COALESCE(pp.person, dd.winner) AS person,
         CASE WHEN pp.person IS NOT NULL THEN 'manual'
              WHEN dd.winner IS NOT NULL THEN 'draw' END AS source
  FROM (SELECT day FROM payers UNION SELECT day FROM draws) t
  LEFT JOIN (SELECT day, NULLIF(person, '') AS person FROM payers) pp ON pp.day = t.day
  LEFT JOIN (SELECT day, NULLIF(winner, '') AS winner FROM draws)  dd ON dd.day = t.day
`

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
    'UPDATE orders SET person = ?, filling = ?, bread = ?, notes = ?, size = ?, price = ?, paid = ?, paid_at = ?, paid_auto = ? WHERE id = ?',
  ),
  delOrder: db.prepare('DELETE FROM orders WHERE id = ?'),
  clearDay: db.prepare('DELETE FROM orders WHERE day = ?'),
  // lo que más repite una persona, para el botón "lo de siempre".
  // Se agrupa por relleno + pan + extras + tamaño ignorando mayúsculas, y la
  // columna desnuda junto a MAX(created_at) devuelve la grafía MÁS RECIENTE
  // de cada combinación (el mismo truco de SQLite que usa q.people).
  // A propósito NO devuelve precio: el que vale es el del catálogo de hoy.
  usual: db.prepare(`
    SELECT filling, bread, notes, size, COUNT(*) AS times, MAX(created_at) AS lastAt
    FROM orders
    WHERE person = ? COLLATE NOCASE AND filling <> ''
    GROUP BY LOWER(filling), LOWER(bread), LOWER(notes), size
    ORDER BY times DESC, lastAt DESC
    LIMIT ?
  `),

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
  // días que una persona debe A UN ACREEDOR concreto (los que puso él el
  // dinero). Solo lectura: el UPDATE sigue siendo settlePersonDay, así toca
  // exactamente los días que se difunden en el mensaje 'paid'.
  unpaidDaysFrom: db.prepare(`
    SELECT DISTINCT o.day AS day
    FROM orders o
    WHERE o.paid = 0 AND o.person = ? COLLATE NOCASE
      AND o.day IN (SELECT day FROM (${DAY_PAYER}) WHERE person = ? COLLATE NOCASE)
    ORDER BY o.day DESC
  `),

  // --- pagado automáticamente por poner el dinero ---
  // el `paid_auto <> 2` es la clave: si su dueño lo desmarcó a mano, ni el
  // sorteo ni un cambio de pagador se lo vuelven a marcar
  autoPay: db.prepare(
    'UPDATE orders SET paid = 1, paid_at = ?, paid_auto = 1 WHERE day = ? AND paid = 0 AND paid_auto <> 2 AND person = ? COLLATE NOCASE',
  ),
  // deshace SOLO lo que se marcó solo y ya no toca. Un "pagado" puesto a mano
  // no se desmarca nunca: la palabra de una persona gana a la automática.
  unAutoPay: db.prepare(
    "UPDATE orders SET paid = 0, paid_at = NULL, paid_auto = 0 WHERE day = ? AND paid_auto = 1 AND person <> ? COLLATE NOCASE",
  ),
  // un pedido recién creado por quien ya pone el dinero ese día. Se marca SOLO
  // ese, para no re-marcar lo que su dueño hubiera desmarcado a mano.
  autoPayOne: db.prepare(
    'UPDATE orders SET paid = 1, paid_at = ?, paid_auto = 1 WHERE id = ? AND paid = 0 AND paid_auto <> 2 AND person = ? COLLATE NOCASE',
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

  // --- pagador (quién puso el dinero) ---
  payerOf: db.prepare(`SELECT person, source FROM (${DAY_PAYER}) WHERE day = ?`),
  setPayer: db.prepare(`
    INSERT INTO payers (day, person, at) VALUES (?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET person = excluded.person, at = excluded.at
  `),
  delPayer: db.prepare('DELETE FROM payers WHERE day = ?'),
  // pagadores fijados a mano, para reenviarlos al conectar (los días con sorteo
  // ya llegan con su pagador dentro del mensaje 'draw')
  recentPayers: db.prepare('SELECT day, person FROM payers ORDER BY day DESC LIMIT ?'),
  // cambiar el pagador NO reescribe lo que ya estaba cobrado: hay que poder decirlo
  paidCountOf: db.prepare('SELECT COUNT(*) AS n FROM orders WHERE day = ? AND paid = 1'),
  autoPaidCountOf: db.prepare('SELECT COUNT(*) AS n FROM orders WHERE day = ? AND paid_auto = 1'),

  // --- deuda con acreedor: quién debe a quién ---
  // Se agrupa por LOWER() en los DOS lados, igual que historyPeople y
  // tallyRange, para que "marta" y "Marta" sean la misma persona en cualquiera
  // de las dos posiciones. Un día sin pagador da creditorKey = '' (deuda
  // huérfana) y un pedido sin nombre da debtorKey = '' (deuda anónima): las dos
  // se etiquetan arriba en vez de esconderlas con un WHERE.
  debtPairs: db.prepare(`
    SELECT LOWER(o.person)                AS debtorKey,
           LOWER(COALESCE(dp.person, '')) AS creditorKey,
           SUM(o.price)                   AS pending,
           COUNT(*)                       AS orders,
           COUNT(DISTINCT o.day)          AS days,
           MAX(o.day)                     AS lastDay
    FROM orders o
    LEFT JOIN (${DAY_PAYER}) dp ON dp.day = o.day
    WHERE o.paid = 0 AND o.day BETWEEN ? AND ?
    GROUP BY LOWER(o.person), LOWER(COALESCE(dp.person, ''))
    HAVING SUM(o.price) > 0
    ORDER BY pending DESC
  `),

  // Grafía canónica de cada persona = la de su pedido MÁS RECIENTE. Mismo truco
  // que q.people: con exactamente un MAX() en la consulta, SQLite hace que las
  // columnas desnudas vengan de la fila de ese máximo.
  // La clave la calcula SQL con LOWER(), NO JS con toLowerCase(): LOWER() de
  // SQLite solo baja ASCII y las claves tienen que cuadrar con el GROUP BY de
  // debtPairs (si no, "MARÍA" se quedaría sin nombre bonito).
  peopleNames: db.prepare(`
    SELECT person AS name, LOWER(person) AS key, MAX(created_at) AS lastAt
    FROM orders WHERE person <> '' GROUP BY LOWER(person)
  `),
  // respaldos: alguien puede pagar (o recoger) sin haber pedido nada
  payerNames: db.prepare(`
    SELECT person AS name, LOWER(person) AS key, MAX(at) AS lastAt
    FROM payers GROUP BY LOWER(person)
  `),
  winnerNames: db.prepare(`
    SELECT winner AS name, LOWER(winner) AS key, MAX(at) AS lastAt
    FROM draws WHERE winner <> '' GROUP BY LOWER(winner)
  `),

  // --- histórico ---
  historyDays: db.prepare(`
    SELECT o.day AS day,
           COUNT(*) AS orders,
           COUNT(DISTINCT CASE WHEN o.person <> '' THEN LOWER(o.person) END) AS people,
           SUM(o.price) AS total,
           SUM(CASE WHEN o.paid = 0 THEN o.price ELSE 0 END) AS pending,
           d.winner AS winner,
           dp.person AS payer,
           dp.source AS payerSource
    FROM orders o
    LEFT JOIN draws d ON d.day = o.day
    LEFT JOIN (${DAY_PAYER}) dp ON dp.day = o.day
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

// mapa clave (LOWER de SQL) → grafía que se enseña. El orden importa: los
// pedidos son la fuente fuerte (es donde la gente escribe su nombre), así que
// van últimos y sobrescriben a los respaldos.
function nameMap() {
  const m = new Map()
  for (const src of [q.winnerNames, q.payerNames, q.peopleNames]) {
    for (const r of src.all()) m.set(r.key, r.name)
  }
  return m
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

/* ----------------------------------------------------------------
   Quién puso el dinero
   ---------------------------------------------------------------- */

/*
 * Sincroniza los pedidos "pagados automáticamente" con el pagador efectivo del
 * día: quien pone el dinero no se debe nada a sí mismo.
 *
 * Es idempotente, así que se llama siempre que cambie el pagador o el ganador.
 * Devuelve cuántas filas ha tocado para no difundir pedidos si no ha cambiado
 * nada. Solo deshace lo que llevaba paid_auto = 1: un pagado puesto a mano no
 * se desmarca jamás.
 */
function syncAutoPaid(day) {
  const payer = q.payerOf.get(day)?.person || null
  let changed = q.unAutoPay.run(day, payer || '').changes
  if (payer) changed += q.autoPay.run(Date.now(), day, payer).changes
  return { payer, changed }
}

// pagador de un día, en la forma que viaja por REST y por el WebSocket.
// `settled` y `auto` van dentro a propósito: cambiar el pagador NO reescribe lo
// que ya estaba cobrado, y eso hay que poder contarlo.
const payerPayload = (day) => {
  const row = q.payerOf.get(day)
  return {
    type: 'payer',
    day,
    payer: row?.person || null, // null = ese día no tiene acreedor
    source: row?.source || null, // 'manual' | 'draw' | null
    settled: q.paidCountOf.get(day).n,
    auto: q.autoPaidCountOf.get(day).n,
  }
}

const drawPayload = (row) => {
  if (!row) return null
  // el pagador viaja CON el sorteo: un ganador nuevo es el acreedor nuevo
  // mientras nadie lo haya fijado a mano, así que el mensaje que anuncia el
  // sorteo es también el que actualiza al acreedor en todas las pantallas
  const p = q.payerOf.get(row.day)
  return {
    type: 'draw',
    day: row.day,
    people: safeJson(row.people, []),
    odds: safeJson(row.odds, []),
    winner: row.winner,
    drawId: row.drawId,
    at: row.at,
    payer: p?.person || null,
    payerSource: p?.source || null,
  }
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

// lo que más pide una persona (aprovecha idx_orders_person)
app.get('/api/orders/usual', (req, res) => {
  const person = str(req.query.person, 40)
  if (!person) return res.status(400).json({ error: 'persona requerida' })
  res.json(q.usual.all(person, clampInt(req.query.limit, 3, 1, 6)))
})

app.post('/api/orders', (req, res) => {
  const day = dayOf(req.body?.day)
  const filling = str(req.body?.filling, 60)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  if (!filling) return res.status(400).json({ error: 'relleno requerido' })
  const size = sizeOf(req.body?.size)
  // precio: el que llega; si no viene, el del catálogo; si tampoco, 0
  const price = cents(req.body?.price) ?? catalogPrice(filling, size) ?? 0
  const person = str(req.body?.person, 40)
  const id = randomUUID()
  q.addOrder.run(
    id,
    day,
    person,
    filling,
    str(req.body?.bread, 40),
    str(req.body?.notes, 80),
    size,
    price,
    boolInt(req.body?.paid),
    Date.now(),
  )
  // si lo pide quien ya pone el dinero ese día, nace pagado: un pedido que
  // llega después de fijar el pagador no se queda descolgado en su deuda
  const payerNow = person ? q.payerOf.get(day)?.person : null
  if (payerNow) q.autoPayOne.run(Date.now(), id, payerNow)
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
  // Si el pago lo toca una persona, su palabra manda de aquí en adelante:
  // desmarcar algo que se había marcado solo lo deja "vetado" (2), para que no
  // se lo vuelvan a marcar ni un resorteo ni un cambio de pagador. Marcarlo a
  // mano lo devuelve a la normalidad (0).
  const paidAuto =
    b.paid === undefined ? existing.paidAuto : !paid && existing.paidAuto === 1 ? 2 : 0

  q.updateOrder.run(keep('person', 40), filling, keep('bread', 40), keep('notes', 80), size, price, paid, paidAt, paidAuto, req.params.id)
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

// --- pagos: saldar lo que debe una persona (opcionalmente de un solo día,
//     y opcionalmente solo lo que le debe A UN ACREEDOR concreto) ---
app.post('/api/payments/settle', (req, res) => {
  const person = str(req.body?.person, 40)
  if (!person) return res.status(400).json({ error: 'persona requerida' })
  const day = req.body?.day === undefined || req.body.day === null ? null : dayOf(req.body.day)
  if (req.body?.day && !day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  // sin acreedor se salda todo, sin mirar quién puso el dinero (lo de siempre).
  // Ojo: acreedor === persona es LEGÍTIMO ("marcar lo mío de los días que pagué
  // yo"), así que no se rechaza.
  const creditor = str(req.body?.creditor, 40)

  const pending = creditor
    ? q.unpaidDaysFrom.all(person, creditor).map((r) => r.day)
    : q.unpaidDays.all(person).map((r) => r.day)
  const days = day ? pending.filter((d) => d === day) : pending
  const now = Date.now()
  // con acreedor se salda día a día: el UPDATE toca EXACTAMENTE los días que se
  // acaban de leer y que se van a difundir, así que no puede haber discrepancia
  if (creditor) for (const d of days) q.settlePersonDay.run(now, person, d)
  else if (day) q.settlePersonDay.run(now, person, day)
  else q.settlePerson.run(now, person)

  // los clientes refrescan el día que estén mirando si aparece en `days`
  broadcast({ type: 'paid', person, days, creditor: creditor || null, by: str(req.body?.clientId, 64) })
  res.json({ ok: true, days })
})

// --- deuda con acreedor: quién debe a quién, de todos los días ---
app.get('/api/debts', (req, res) => {
  const from = dayOf(req.query.from) || DAY_MIN
  const to = dayOf(req.query.to) || DAY_MAX
  const names = nameMap()
  const show = (key) => (key ? names.get(key) || key : null)

  const rows = q.debtPairs.all(from, to).map((r) => ({
    debtor: show(r.debtorKey),
    debtorKey: r.debtorKey,
    creditor: show(r.creditorKey),
    creditorKey: r.creditorKey,
    pending: r.pending || 0,
    orders: r.orders,
    days: r.days,
    lastDay: r.lastDay,
    // pair   = X le debe a Y
    // self   = puso el dinero y su propio bocata sigue sin marcar
    // orphan = ese día no hay pagador: no se sabe a quién devolvérselo
    // anon   = pedido sin nombre: no se sabe quién lo debe
    kind: !r.debtorKey
      ? 'anon'
      : !r.creditorKey
        ? 'orphan'
        : r.creditorKey === r.debtorKey
          ? 'self'
          : 'pair',
  }))

  // total por deudor: es LO MISMO que pinta «deuda acumulada», derivado de estas
  // mismas filas para que los dos números no puedan discrepar nunca
  const byKey = new Map()
  for (const r of rows) {
    if (!r.debtorKey) continue
    const cur = byKey.get(r.debtorKey) || { name: r.debtor, key: r.debtorKey, pending: 0, days: 0 }
    cur.pending += r.pending
    cur.days = Math.max(cur.days, r.days)
    byKey.set(r.debtorKey, cur)
  }
  const byPerson = [...byKey.values()].sort(
    (a, b) => b.pending - a.pending || a.name.localeCompare(b.name),
  )

  const sum = (kind) => rows.reduce((t, r) => t + (r.kind === kind ? r.pending : 0), 0)
  res.json({
    from,
    to,
    rows,
    byPerson,
    totals: {
      all: rows.reduce((t, r) => t + r.pending, 0),
      pair: sum('pair'),
      self: sum('self'),
      orphan: sum('orphan'),
      anon: sum('anon'),
    },
  })
})

// --- pagador: quién puso el dinero un día ---
// por defecto es quien recogió; aquí solo se guardan las correcciones a mano
app.get('/api/payers', (req, res) => {
  const day = dayOf(req.query.day)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  res.json(payerPayload(day))
})

app.put('/api/payers', (req, res) => {
  const day = dayOf(req.body?.day)
  if (!day) return res.status(400).json({ error: 'day inválido (YYYY-MM-DD)' })
  // persona vacía = quitar la corrección y volver a seguir a quien recoja. No es
  // un error: es la forma de soltar el pagador, como desmarcar una ausencia.
  const person = str(req.body?.person, 40)
  // se guarda la grafía CANÓNICA (la del pedido más reciente de esa persona)
  // para que el nombre del pagador y el de la lista de deuda no se contradigan
  // en la misma pantalla. Si no se reconoce, se respeta lo que hayan escrito.
  const canon = person ? nameMap().get(person.toLowerCase()) || person : ''
  if (canon) q.setPayer.run(day, canon, Date.now())
  else q.delPayer.run(day)

  const by = str(req.body?.clientId, 64)
  // quien pone el dinero no se debe nada a sí mismo: sus pedidos de ese día
  // quedan pagados, y los del pagador anterior vuelven a deberse
  if (syncAutoPaid(day).changed) pushOrders(day, by)
  const payload = payerPayload(day)
  broadcast({ ...payload, by })
  res.json(payload)
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
  const base = { type: 'draw', day, people: reel, odds, winner, drawId: randomUUID(), at: Date.now() }
  q.saveDraw.run(day, base.drawId, winner, JSON.stringify(reel), JSON.stringify(odds), base.at)
  // el pagador se lee DESPUÉS de guardar: si nadie lo ha fijado a mano, quien
  // acaba de ganar es el acreedor nuevo y sus bocatas quedan pagados
  const by = str(req.body?.clientId, 64)
  const { payer, changed } = syncAutoPaid(day)
  const payload = { ...base, payer, payerSource: q.payerOf.get(day)?.source || null }
  // announce: false => abrir la tragaperras y animar; el iniciador entra por aquí también
  broadcast({ ...payload, by })
  if (changed) pushOrders(day, by)
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
  const by = str(req.body?.clientId, 64)
  // corregir quién recogió arrastra al pagador mientras nadie lo haya fijado
  const changed = syncAutoPaid(day).changed
  const payload = drawPayload(q.draw.get(day))
  // announce: true => solo actualiza el banner, sin reabrir la tragaperras
  broadcast({ ...payload, announce: true, by })
  if (changed) pushOrders(day, by)
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
  const p = q.payerOf.get(day)
  res.json({
    day,
    orders: q.ordersByDay.all(day),
    draw: drawPayload(q.draw.get(day)) || null,
    payer: p?.person || null,
    payerSource: p?.source || null,
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
  // los días con sorteo ya llegan con su pagador dentro del mensaje 'draw':
  // esto cubre los días con pagador fijado a mano y SIN sorteo
  for (const row of q.recentPayers.all(DRAW_REPLAY)) {
    socket.send(JSON.stringify(payerPayload(row.day)))
  }
})
