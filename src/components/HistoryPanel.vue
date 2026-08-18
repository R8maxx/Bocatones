<script setup>
import { computed, onMounted, ref } from 'vue'
import OrderList from './OrderList.vue'
import { useHistory } from '../composables/useHistory.js'
import { personEmoji } from '../composables/usePersonEmoji.js'
import { fmt, fmtOrDash } from '../money.js'

/*
 * HistoryPanel — modo histórico. Tres bloques:
 *   1. días anteriores (con quién recogió) y su detalle
 *   2. resumen por persona: gasto, deuda acumulada y veces que ha ido
 *   3. "a quién le toca": papeletas y probabilidad de los candidatos de hoy
 *
 * Se monta solo al entrar en el histórico, así que la carga es perezosa.
 */

const { days, selectedDay, dayDetail, people, odds, totals, loading, error, load, select, setPaid, settle, setWinner } =
  useHistory()

onMounted(load)

// 'YYYY-MM-DD' -> "lun 17 ago" (sin desfase de zona horaria)
function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
    .toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace('.', '')
}

// personas de ese día, para poder corregir quién recogió de verdad
const dayPeople = computed(() => {
  const seen = new Set()
  const out = []
  for (const o of dayDetail.value?.orders || []) {
    const n = (o.person || '').trim()
    const k = n.toLowerCase()
    if (n && !seen.has(k)) {
      seen.add(k)
      out.push(n)
    }
  }
  return out
})

const editingWinner = ref(false)
async function chooseWinner(e) {
  const name = e.target.value
  editingWinner.value = false
  if (name) await setWinner(selectedDay.value, name)
}

// probabilidad con coma decimal, como el resto de los números de la app
const PCT = new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 1 })
const pct = (chance) => PCT.format(chance)

const maxSpent = computed(() => Math.max(1, ...people.value.map((p) => p.spent)))

function askSettle(person, pending) {
  if (window.confirm(`¿Marcar como pagado todo lo que debe ${person} (${fmt(pending)})?`)) {
    settle(person)
  }
}
</script>

<template>
  <div class="hist">
    <p v-if="error" class="h-error">⚠ no se pudo cargar el histórico — {{ error }}</p>

    <!-- ================= días ================= -->
    <section class="block">
      <div class="b-head">
        <h2><span class="hash">#</span> días anteriores</h2>
        <span v-if="days.length" class="b-meta">
          {{ totals.orders }} bocatas · {{ fmt(totals.total) }}
          <template v-if="totals.pending"> · <b class="due">{{ fmt(totals.pending) }} sin pagar</b></template>
        </span>
      </div>

      <p v-if="loading && !days.length" class="h-empty">cargando histórico… <span class="blink">_</span></p>
      <p v-else-if="!days.length" class="h-empty">todavía no hay días guardados.</p>

      <ul v-else class="d-rows">
        <li v-for="d in days" :key="d.day">
          <button
            class="d-row"
            type="button"
            :class="{ open: selectedDay === d.day }"
            :aria-expanded="selectedDay === d.day"
            @click="select(d.day)"
          >
            <span class="d-caret" aria-hidden="true">{{ selectedDay === d.day ? '▾' : '▸' }}</span>
            <span class="d-date">{{ dayLabel(d.day) }}</span>
            <span class="d-who">
              <template v-if="d.winner">
                <span class="d-emoji">{{ personEmoji(d.winner) }}</span>{{ d.winner }}
              </template>
              <span v-else class="d-nowho">— sin sorteo —</span>
            </span>
            <span class="d-n">{{ d.orders }} 🥪</span>
            <span class="d-total">{{ fmtOrDash(d.total) }}</span>
            <span class="d-pend" :class="{ zero: !d.pending }">{{ d.pending ? fmt(d.pending) : '✓' }}</span>
          </button>

          <!-- detalle del día -->
          <div v-if="selectedDay === d.day && dayDetail" class="d-detail">
            <div class="dd-head">
              <span class="dd-lbl">// recogió</span>
              <template v-if="!editingWinner">
                <span class="dd-winner">
                  <span class="d-emoji">{{ dayDetail.draw ? personEmoji(dayDetail.draw.winner) : '❔' }}</span>
                  {{ dayDetail.draw?.winner || 'sin registrar' }}
                </span>
                <button v-if="dayPeople.length" class="dd-fix" type="button" @click="editingWinner = true">
                  ✎ corregir
                </button>
              </template>
              <select v-else class="dd-sel" aria-label="quién recogió de verdad" @change="chooseWinner">
                <option value="">elige…</option>
                <option v-for="p in dayPeople" :key="p" :value="p">{{ p }}</option>
              </select>
              <span class="dd-money">
                {{ fmt(dayDetail.totals.total) }}
                <template v-if="dayDetail.totals.pending">
                  · <b class="due">{{ fmt(dayDetail.totals.pending) }} pendiente</b>
                </template>
              </span>
            </div>

            <OrderList
              v-if="dayDetail.orders.length"
              :orders="dayDetail.orders"
              readonly
              @paid="setPaid"
            />
          </div>
        </li>
      </ul>
    </section>

    <!-- ================= por persona ================= -->
    <section class="block">
      <div class="b-head">
        <h2><span class="hash">#</span> por persona</h2>
        <span class="b-meta">gasto · deuda · veces que ha ido</span>
      </div>

      <p v-if="!people.length" class="h-empty">nadie ha pedido todavía.</p>

      <ul v-else class="p-rows">
        <li v-for="p in people" :key="p.name" class="p-row">
          <span class="p-who">
            <span class="d-emoji">{{ personEmoji(p.name) }}</span>
            <span class="p-name">{{ p.name }}</span>
          </span>
          <span class="p-bar" aria-hidden="true">
            <span class="p-fill" :style="{ width: (p.spent / maxSpent) * 100 + '%' }" />
          </span>
          <span class="p-num" :title="`${p.orders} bocatas en ${p.days} días`">{{ p.orders }} 🥪</span>
          <span class="p-num">{{ p.gone }}× 🎰</span>
          <span class="p-num spent">{{ fmtOrDash(p.spent) }}</span>
          <span class="p-pend">
            <template v-if="p.pending">
              <button class="p-settle" type="button" @click="askSettle(p.name, p.pending)">
                debe {{ fmt(p.pending) }} · saldar
              </button>
            </template>
            <span v-else class="p-ok">✓ al día</span>
          </span>
        </li>
      </ul>
    </section>

    <!-- ================= a quién le toca ================= -->
    <section class="block">
      <div class="b-head">
        <h2><span class="hash">#</span> a quién le toca</h2>
        <span class="b-meta">papeletas del sorteo de hoy</span>
      </div>

      <p v-if="!odds || !odds.candidates.length" class="h-empty">
        no hay pedidos de hoy: no hay nada que sortear todavía.
      </p>

      <template v-else>
        <p class="o-note">
          Quien menos ha ido tiene más papeletas. Sigue siendo un sorteo: nadie llega nunca al 0%.
          Quien no pueda ir se marca desde la tragaperras y queda fuera del reparto.
        </p>
        <p v-if="odds.winner" class="o-done">
          <span class="d-emoji">{{ personEmoji(odds.winner) }}</span>
          Hoy ya ha recogido <b>{{ odds.winner }}</b> — estos son los porcentajes si volvéis a sortear
          (no se penaliza el sorteo que se reemplaza).
        </p>
        <ul class="o-rows">
          <li v-for="c in odds.candidates" :key="c.name" class="o-row" :class="{ away: !c.available }">
            <span class="p-who">
              <span class="d-emoji">{{ personEmoji(c.name) }}</span>
              <span class="p-name">{{ c.name }}</span>
            </span>
            <span class="o-gone">
              <span class="o-dots" aria-hidden="true">
                <i v-for="n in Math.min(c.gone, 10)" :key="n" />
              </span>
              <span class="o-gone-n">{{ c.gone }}× ido</span>
            </span>
            <span v-if="!c.available" class="o-awaytxt">hoy no puede ir</span>
            <template v-else>
              <span class="o-bar" aria-hidden="true">
                <span class="o-fill" :style="{ width: c.chance * 100 + '%' }" />
              </span>
              <span class="o-pct">{{ pct(c.chance) }}</span>
            </template>
          </li>
        </ul>
      </template>
    </section>
  </div>
</template>

<style scoped>
.hist { display: flex; flex-direction: column; gap: clamp(1.4rem, 3.5vw, 2.4rem); }

.block { min-width: 0; }
.b-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  margin-bottom: 1rem;
  padding-bottom: 0.65rem;
  border-bottom: 1px solid var(--line-2);
}
.b-head h2 {
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.hash { color: var(--ink-faint); }
.b-meta { font-size: 0.72rem; color: var(--ink-faint); letter-spacing: 0.04em; }
.due { color: var(--g6); font-weight: 700; }

.h-error {
  font-size: 0.8rem;
  color: var(--g6);
  border: 1px solid var(--g6);
  border-radius: var(--radius);
  padding: 0.6rem 0.9rem;
  background: rgba(212, 105, 30, 0.08);
}
.h-empty {
  font-size: 0.84rem;
  color: var(--ink-dim);
  padding: 1.4rem 0.2rem;
  text-align: center;
}
.blink { animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0.15; } }

/* ---- días ---- */
.d-rows, .p-rows, .o-rows { list-style: none; display: flex; flex-direction: column; gap: 0.45rem; }

.d-row {
  width: 100%;
  display: grid;
  grid-template-columns: 1rem 5.6rem 1fr auto 4.6rem 4.6rem;
  align-items: center;
  gap: 0.7rem;
  text-align: left;
  font-family: var(--mono);
  font-size: 0.82rem;
  color: var(--ink-dim);
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-left: 2px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.6rem 0.8rem;
  cursor: pointer;
  transition: border-color 0.18s, background 0.18s, transform 0.18s;
}
.d-row:hover { border-left-color: var(--ink); background: var(--panel); transform: translateX(3px); }
.d-row.open { border-left-color: var(--g7); background: var(--panel); color: var(--ink); }
.d-caret { color: var(--ink-faint); }
.d-date { color: var(--ink); white-space: nowrap; }
.d-who {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.d-emoji { font-size: 1.05rem; line-height: 1; }
.d-nowho { color: var(--ink-faint); font-style: italic; }
.d-n, .d-total, .d-pend { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.d-pend { color: var(--g6); }
.d-pend.zero { color: var(--g5); }

@media (max-width: 720px) {
  .d-row { grid-template-columns: 1rem 1fr auto auto; }
  .d-who { grid-column: 2; }
  .d-total { display: none; }
}

.d-detail {
  border: 1px solid var(--line);
  border-top: none;
  border-radius: 0 0 var(--radius) var(--radius);
  padding: 0.9rem;
  background: var(--bg);
}
.dd-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 0.9rem;
  margin-bottom: 0.9rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px dashed var(--line-2);
  font-size: 0.8rem;
}
.dd-lbl { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-faint); }
.dd-winner { display: inline-flex; align-items: center; gap: 0.45ch; color: var(--ink); font-weight: 700; }
.dd-money { margin-left: auto; color: var(--ink-dim); font-variant-numeric: tabular-nums; }
.dd-fix, .p-settle {
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
  transition: all 0.15s;
}
.dd-fix:hover { color: var(--bg); background: var(--g7); border-color: var(--g7); }
.dd-sel {
  font-family: var(--mono);
  font-size: 0.8rem;
  color: var(--ink);
  background: var(--bg-soft);
  border: 1px solid var(--ink);
  border-radius: var(--radius);
  padding: 0.25rem 0.5rem;
}

/* ---- por persona ---- */
.p-row, .o-row {
  display: grid;
  align-items: center;
  gap: 0.7rem;
  font-size: 0.82rem;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 0.6rem 0.8rem;
}
.p-row { grid-template-columns: minmax(6rem, 1fr) 60px auto auto 4.8rem auto; }
.p-who { min-width: 0; display: inline-flex; align-items: center; gap: 0.5ch; }
.p-name { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p-bar, .o-bar { height: 6px; background: var(--line); border-radius: 999px; overflow: hidden; }
.p-fill { display: block; height: 100%; background: var(--ink-dim); border-radius: 999px; transition: width 0.4s ease; }
.p-num { color: var(--ink-dim); font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
.p-num.spent { color: var(--ink); }
.p-pend { text-align: right; }
.p-ok { font-size: 0.74rem; color: var(--g5); white-space: nowrap; }
.p-settle { color: var(--g6); border-color: color-mix(in srgb, var(--g6) 45%, var(--line-2)); white-space: nowrap; }
.p-settle:hover { color: var(--bg); background: var(--g6); border-color: var(--g6); }

@media (max-width: 720px) {
  .p-row { grid-template-columns: 1fr auto; row-gap: 0.4rem; }
  .p-bar { display: none; }
  .p-pend { grid-column: 1 / -1; text-align: left; }
}

/* ---- a quién le toca ---- */
.o-note { font-size: 0.76rem; color: var(--ink-dim); margin-bottom: 0.9rem; }
.o-done {
  display: flex;
  align-items: center;
  gap: 0.5ch;
  flex-wrap: wrap;
  font-size: 0.74rem;
  color: var(--ink-dim);
  border-left: 2px solid var(--g5);
  padding: 0.45rem 0.7rem;
  margin-bottom: 0.9rem;
  background: var(--bg-soft);
}
.o-done b { color: var(--ink); }
.o-row { grid-template-columns: minmax(6rem, 1fr) auto minmax(60px, 130px) 4rem; }
.o-gone { display: inline-flex; align-items: center; gap: 0.5ch; color: var(--ink-faint); font-size: 0.74rem; }
.o-dots { display: inline-flex; gap: 2px; }
.o-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--ink-faint); }
.o-gone-n { white-space: nowrap; font-variant-numeric: tabular-nums; }
.o-fill { display: block; height: 100%; background: var(--ink); border-radius: 999px; transition: width 0.4s ease; }
.o-row.away { opacity: 0.55; }
.o-row.away .p-name { text-decoration: line-through; }
.o-awaytxt {
  grid-column: 3 / -1;
  text-align: right;
  font-size: 0.7rem;
  color: var(--g6);
  white-space: nowrap;
}
.o-pct {
  font-family: var(--crt);
  font-size: 1.15rem;
  line-height: 1;
  color: var(--ink);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 560px) {
  .o-row { grid-template-columns: 1fr auto; row-gap: 0.35rem; }
  .o-bar { grid-column: 1 / -1; }
}

@media (prefers-reduced-motion: reduce) {
  .d-row:hover { transform: none; }
  .p-fill, .o-fill { transition: none; }
  .blink { animation: none; }
}
</style>
