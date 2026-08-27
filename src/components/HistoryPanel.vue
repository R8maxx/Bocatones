<script setup>
import { computed, onMounted, ref } from 'vue'
import OrderList from './OrderList.vue'
import MoneyValue from './MoneyValue.vue'
import PctValue from './PctValue.vue'
import { useHistory } from '../composables/useHistory.js'
import { todayKey } from '../api.js'
import { personEmoji } from '../composables/usePersonEmoji.js'
import { useMe } from '../composables/useMe.js'
import { fmt, fmtOrDash } from '../money.js'
import { confirmSettle } from '../composables/useSettle.js'
import { useInlineEdit } from '../composables/useInlineEdit.js'

/*
 * HistoryPanel — modo histórico. Tres bloques:
 *   1. días anteriores (con quién recogió) y su detalle
 *   2. resumen por persona: gasto, deuda acumulada y veces que ha ido
 *   3. "a quién le toca": papeletas y probabilidad de los candidatos de hoy
 *
 * Se monta solo al entrar en el histórico, así que la carga es perezosa.
 */

const { isMe } = useMe()

const {
  days, selectedDay, dayDetail, people, odds, totals, creditorsOf,
  loading, detailLoading, ready, error,
  load, select, setPaid, settle, setWinner, setPayer,
} = useHistory()

const today = todayKey()

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

/*
 * Los dos correctores del día. Comparten useInlineEdit con los de la portada,
 * y sobre todo comparten la salida que les faltaba: sólo el evento `change`
 * los cerraba, así que abrir el desplegable obligaba a corregir algo para
 * poder salir. Ahora Escape, el botón ✕ y quitar el foco cierran sin tocar
 * nada.
 */
const {
  editing: editingWinner, el: winnerSel,
  open: openWinnerEdit, cancel: cancelWinnerEdit, blur: blurWinnerEdit,
} = useInlineEdit()
const {
  editing: editingPayer, el: payerSel,
  open: openPayerEdit, cancel: cancelPayerEdit, blur: blurPayerEdit,
} = useInlineEdit()

async function chooseWinner(e) {
  const name = e.target.value
  cancelWinnerEdit()
  if (name) await setWinner(selectedDay.value, name)
}

// cadena vacía = ese día vuelve a pagar quien recogió
async function choosePayer(e) {
  const name = e.target.value
  cancelPayerEdit()
  await setPayer(selectedDay.value, name)
}

/*
 * Los dos correctores son estado del PANEL, no de la fila: si se despliega otro
 * día con un selector abierto, se queda abierto sobre datos que no son los
 * suyos. Se cierran al cambiar de día.
 */
function openDay(day) {
  cancelWinnerEdit()
  cancelPayerEdit()
  return select(day)
}

const maxSpent = computed(() => Math.max(1, ...people.value.map((p) => p.spent)))

async function askSettle(person, pending) {
  if (await confirmSettle(person, pending)) settle(person).catch(() => {})
}
</script>

<template>
  <div class="hist">
    <p v-if="error" class="h-error" role="alert">⚠ no se pudo cargar el histórico — {{ error }}</p>

    <!-- ================= días ================= -->
    <section class="block">
      <div class="b-head">
        <h2><span class="hash" aria-hidden="true">#</span> todos los días</h2>
        <span v-if="days.length" class="b-meta">
          {{ totals.orders }} bocatas · <MoneyValue :cents="totals.total" />
          <template v-if="totals.pending"> · <b class="due"><MoneyValue :cents="totals.pending" /> sin pagar</b></template>
        </span>
      </div>

      <!-- la lista de abajo es hermana, no alternativa (siempre se pinta), así
           que aquí lo único que saltaba era el relevo cargando <-> vacío -->
      <Transition name="swap" mode="out-in">
        <p v-if="loading && !days.length" key="loading" class="h-empty">cargando histórico… <span class="blink">_</span></p>
        <p v-else-if="!days.length" key="empty" class="h-empty">todavía no hay días guardados.</p>
      </Transition>

      <div class="d-cols" aria-hidden="true">
        <span />
        <span>día</span>
        <span>recogió</span>
        <span>bocatas</span>
        <span>total</span>
        <span>debe</span>
      </div>

      <!-- dias nuevos entran por arriba; -move recoloca a los de abajo -->
      <TransitionGroup name="list" tag="ul" class="d-rows">
        <li v-for="(d, i) in days" :key="d.day" :style="{ '--i': Math.min(i, 12) }">
          <button
            class="d-row"
            type="button"
            :class="{ open: selectedDay === d.day }"
            :aria-expanded="selectedDay === d.day"
            @click="openDay(d.day)"
          >
            <span class="d-caret" aria-hidden="true">{{ selectedDay === d.day ? '▾' : '▸' }}</span>
            <span class="d-date">
              <span>{{ dayLabel(d.day) }}</span>
              <small v-if="d.day === today" class="d-today">hoy</small>
            </span>
            <span class="d-who">
              <span class="d-whotxt">
                <template v-if="d.winner">
                  <span class="d-emoji">{{ personEmoji(d.winner) }}</span>{{ d.winner }}
                </template>
                <span v-else class="d-nowho">— sin sorteo —</span>
              </span>
              <!-- solo cuando no coinciden: si paga quien recoge, no hace falta decirlo -->
              <small
                v-if="d.payer && d.payer.toLowerCase() !== (d.winner || '').toLowerCase()"
                class="d-paid"
                :title="`ese día puso el dinero ${d.payer}`"
              >💳 {{ d.payer }}</small>
            </span>
            <span class="d-n">
              {{ d.orders }}<span aria-hidden="true"> 🥪</span>
              <span class="sr-only"> bocatas</span>
            </span>
            <span class="d-total">
              <span class="d-lbl" aria-hidden="true">total</span>
              <MoneyValue :cents="d.total" dash />
            </span>
            <span class="d-pend" :class="{ zero: !d.pending }">
              <span class="d-lbl" aria-hidden="true">debe</span>
              <template v-if="d.pending"><MoneyValue :cents="d.pending" /></template>
              <template v-else><span aria-hidden="true">✓</span><span class="sr-only">todo pagado</span></template>
            </span>
          </button>

          <!--
            Detalle del día. El desplegado va con la transición `collapse`
            (grid-template-rows 0fr → 1fr): anima a la altura REAL del
            contenido, sin medir con JavaScript ni inventar un max-height que
            o recorta o deja un tramo muerto al plegar.
          -->
          <Transition name="collapse">
          <div v-if="selectedDay === d.day && detailLoading && !dayDetail" class="d-detail">
            <p class="h-empty">cargando el día… <span class="blink" aria-hidden="true">_</span></p>
          </div>

          <div v-else-if="selectedDay === d.day && dayDetail" class="d-detail">
            <div class="dd-head">
              <span class="dd-lbl">// recogió</span>
              <template v-if="!editingWinner">
                <span class="dd-winner">
                  <span class="d-emoji">{{ dayDetail.draw ? personEmoji(dayDetail.draw.winner) : '❔' }}</span>
                  {{ dayDetail.draw?.winner || 'sin registrar' }}
                </span>
                <button v-if="dayPeople.length" class="dd-fix" type="button" @click="openWinnerEdit()">
                  ✎ corregir
                </button>
              </template>
              <span v-else class="dd-edit">
                <select
                  ref="winnerSel"
                  class="dd-sel"
                  aria-label="quién recogió de verdad"
                  :value="dayDetail.draw?.winner || ''"
                  @change="chooseWinner"
                  @keydown.esc.stop.prevent="cancelWinnerEdit()"
                  @blur="blurWinnerEdit()"
                >
                  <option value="" disabled>elige…</option>
                  <option v-for="p in dayPeople" :key="p" :value="p">{{ p }}</option>
                </select>
                <button class="dd-x" type="button" title="Dejarlo como estaba" @click="cancelWinnerEdit()">✕</button>
              </span>
              <span class="dd-lbl">// pagó</span>
              <template v-if="!editingPayer">
                <span class="dd-winner">
                  <span class="d-emoji">{{ dayDetail.payer ? personEmoji(dayDetail.payer) : '❔' }}</span>
                  {{ dayDetail.payer || 'sin pagador' }}
                  <small v-if="dayDetail.payerSource === 'draw'" class="dd-src">// quien recogió</small>
                </span>
                <button class="dd-fix" type="button" @click="openPayerEdit()">✎ cambiar</button>
              </template>
              <span v-else class="dd-edit">
                <select
                  ref="payerSel"
                  class="dd-sel"
                  aria-label="quién puso el dinero ese día"
                  :value="dayDetail.payerSource === 'manual' ? dayDetail.payer : ''"
                  @change="choosePayer"
                  @keydown.esc.stop.prevent="cancelPayerEdit()"
                  @blur="blurPayerEdit()"
                >
                  <option value="">— sigue a quien recogió —</option>
                  <option v-for="p in dayPeople" :key="p" :value="p">{{ p }}</option>
                </select>
                <button class="dd-x" type="button" title="Dejarlo como estaba" @click="cancelPayerEdit()">✕</button>
              </span>
              <span class="dd-money">
                <MoneyValue :cents="dayDetail.totals.total" />
                <template v-if="dayDetail.totals.pending">
                  · <b class="due"><MoneyValue :cents="dayDetail.totals.pending" /> pendiente</b>
                </template>
              </span>
            </div>

            <OrderList
              v-if="dayDetail.orders.length"
              :orders="dayDetail.orders"
              readonly
              @paid="setPaid"
            />
            <p v-else class="h-empty">ese día no se pidió nada.</p>
          </div>
          </Transition>
        </li>
      </TransitionGroup>
    </section>

    <!-- ================= por persona ================= -->
    <section v-reveal class="block">
      <div class="b-head">
        <h2><span class="hash">#</span> por persona</h2>
        <span class="b-meta">bocatas · veces que ha ido · gasto · deuda</span>
      </div>

      <Transition name="swap" mode="out-in">
      <p v-if="!ready" key="loading" class="h-empty">cargando… <span class="blink" aria-hidden="true">_</span></p>
      <p v-else-if="!people.length" key="empty" class="h-empty">nadie ha pedido todavía.</p>

      <!-- esta lista se reordena segun el gasto: -move la desliza en vez de saltar.
           Un <TransitionGroup> dentro de un <Transition> es correcto: el de fuera
           releva el bloque entero, el de dentro mueve sus filas. -->
      <TransitionGroup v-else key="list" name="list" tag="ul" class="p-rows">
        <li
          v-for="(p, i) in people"
          :key="p.name"
          class="p-row"
          :class="{ mine: isMe(p.name) }"
          :style="{ '--i': Math.min(i, 12) }"
        >
          <span class="p-who">
            <span class="d-emoji">{{ personEmoji(p.name) }}</span>
            <span class="p-name">{{ p.name }}</span>
          </span>
          <span class="p-bar" aria-hidden="true">
            <span class="p-fill" :style="{ '--fill': p.spent / maxSpent }" />
          </span>
          <span class="p-num" :title="`${p.orders} bocatas en ${p.days} días`">
            {{ p.orders }}<span aria-hidden="true"> 🥪</span><span class="sr-only"> bocatas</span>
          </span>
          <span class="p-num">
            {{ p.gone }}×<span aria-hidden="true"> 🎰</span><span class="sr-only"> veces que ha ido</span>
          </span>
          <span class="p-num spent"><MoneyValue :cents="p.spent" dash /></span>
          <span class="p-pend">
            <template v-if="p.pending">
              <button class="p-settle" type="button" @click="askSettle(p.name, p.pending)">
                <span>debe</span>&nbsp;<MoneyValue :cents="p.pending" />&nbsp;<span>· saldar</span>
              </button>
              <small v-if="creditorsOf(p.name).length" class="p-to">
                a {{ creditorsOf(p.name).map((c) => `${c.creditor} ${fmt(c.pending)}`).join(' · ') }}
              </small>
            </template>
            <span v-else class="p-ok">✓ al día</span>
          </span>
        </li>
      </TransitionGroup>
      </Transition>
    </section>

    <!-- ================= a quién le toca ================= -->
    <section v-reveal class="block">
      <div class="b-head">
        <h2><span class="hash">#</span> a quién le toca</h2>
        <span class="b-meta">papeletas del sorteo de hoy</span>
      </div>

      <Transition name="swap" mode="out-in">
      <p v-if="!ready" key="loading" class="h-empty">cargando… <span class="blink" aria-hidden="true">_</span></p>
      <p v-else-if="!odds || !odds.candidates.length" key="empty" class="h-empty">
        no hay pedidos de hoy: no hay nada que sortear todavía.
      </p>

      <!-- el <div> no es de adorno: esta rama tenía TRES raíces y un
           <Transition> solo acepta un hijo. `.block` es un bloque pelado y los
           tres hijos solo usan margin-bottom, así que envolverlos no mueve nada. -->
      <div v-else key="odds">
        <p class="o-note">
          Quien menos ha ido tiene más papeletas. Sigue siendo un sorteo: nadie llega nunca al 0%.
          Quien no pueda ir se marca desde la tragaperras y queda fuera del reparto.
        </p>
        <p v-if="odds.winner" class="o-done">
          <span class="d-emoji">{{ personEmoji(odds.winner) }}</span>
          Hoy ya ha recogido <b>{{ odds.winner }}</b> — estos son los porcentajes si volvéis a sortear
          (no se penaliza el sorteo que se reemplaza).
        </p>
        <!-- se reordena en cada toggle: disponibles primero, luego por probabilidad -->
        <TransitionGroup name="list" tag="ul" class="o-rows">
          <li
            v-for="(c, i) in odds.candidates"
            :key="c.name"
            class="o-row"
            :class="{ away: !c.available, mine: isMe(c.name) }"
            :style="{ '--i': Math.min(i, 12) }"
          >
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
                <span class="o-fill" :style="{ '--fill': c.chance }" />
              </span>
              <span class="o-pct"><PctValue :chance="c.chance" /></span>
            </template>
          </li>
        </TransitionGroup>
      </div>
      </Transition>
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
  font-size: var(--fs-3);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.hash { color: var(--ink-faint); }
.b-meta { font-size: var(--fs-2); color: var(--ink-faint); letter-spacing: 0.04em; }
.due { color: var(--g6); font-weight: 700; }

.h-error {
  font-size: var(--fs-2);
  color: var(--g6);
  border: 1px solid var(--g6);
  border-radius: var(--radius);
  padding: 0.6rem 0.9rem;
  background: rgba(212, 105, 30, 0.08);
}
.h-empty {
  font-size: var(--fs-3);
  color: var(--ink-dim);
  padding: 1.4rem 0.2rem;
  text-align: center;
}
.blink { animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0.15; } }

/* cabecera de columnas: antes la fila terminaba en dos importes idénticos sin
   forma de saber cuál era el total y cuál lo pendiente */
.d-cols {
  display: grid;
  grid-template-columns: 1rem minmax(5.6rem, auto) minmax(0, 1fr) auto minmax(4.6rem, auto) minmax(4.6rem, auto);
  gap: 0.7rem;
  padding: 0 0.8rem var(--sp-1);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.d-cols span:nth-child(n + 4) { text-align: right; }

.d-today {
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bg);
  background: var(--ink-dim);
  border-radius: var(--radius-pill);
  padding: 0.05rem 0.4rem;
}

/* etiqueta corta delante de cada importe: solo aparece cuando la cabecera de
   columnas desaparece por falta de sitio */
.d-lbl { display: none; }

/* ---- días ---- */
/* relative porque .list-leave-active saca al que se va con position: absolute */
.d-rows, .p-rows, .o-rows { list-style: none; display: flex; flex-direction: column; gap: var(--sp-2); position: relative; }

/* entrada escalonada, igual que en la cola de pedidos */
.d-rows > li,
.p-rows > li,
.o-rows > li {
  animation: hist-in 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  animation-delay: calc(var(--i, 0) * 40ms);
}
@keyframes hist-in {
  from { opacity: 0; transform: translateY(-6px); }
}

.d-row {
  width: 100%;
  display: grid;
  /* los importes van en minmax(): en es-ES el punto de los miles no aparece
     hasta 10.000 €, y "12.345,60 €" son 11 caracteres que no cabían en un
     track fijo de 4.6rem — se salían y se solapaban */
  grid-template-columns: 1rem minmax(5.6rem, auto) minmax(0, 1fr) auto minmax(4.6rem, auto) minmax(4.6rem, auto);
  align-items: center;
  gap: 0.7rem;
  text-align: left;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink-dim);
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-left: 2px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.6rem 0.8rem;
  cursor: pointer;
  transition:
    border-color var(--dur-2) var(--ease-out),
    background var(--dur-2) var(--ease-out),
    transform var(--dur-2) var(--ease-out);
}
.d-row:hover { border-left-color: var(--ink); background: var(--panel); transform: translateX(3px); }
.d-row.open { border-left-color: var(--g7); background: var(--panel); color: var(--ink); }
.d-caret { color: var(--ink-faint); }
.d-date { color: var(--ink); white-space: nowrap; display: inline-flex; align-items: center; gap: 0.5ch; }
/* nombre arriba y, debajo, quién puso el dinero cuando no es quien recogió */
.d-who {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.d-whotxt {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.d-emoji { font-size: var(--fs-4); line-height: 1; }
.d-nowho { color: var(--ink-faint); font-style: italic; }
.d-n, .d-total, .d-pend {
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.d-pend { color: var(--g6); }
.d-pend.zero { color: var(--g5); }

@media (max-width: 720px) {
  .d-cols { display: none; }
  .d-row { grid-template-columns: 1rem 1fr auto auto; }
  .d-who { grid-column: 2; }
  .d-total { display: none; }
  /* sin cabecera de columnas, cada importe lleva su etiqueta */
  .d-lbl {
    display: inline;
    margin-right: 0.4ch;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-faint);
  }
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
  font-size: var(--fs-2);
}
.dd-lbl { font-size: var(--fs-1); text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-faint); }
.dd-winner { display: inline-flex; align-items: center; gap: 0.45ch; color: var(--ink); font-weight: 700; }
.dd-money { margin-left: auto; color: var(--ink-dim); font-variant-numeric: tabular-nums; }
.dd-fix, .p-settle {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  font-family: var(--mono);
  font-size: var(--fs-1);
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    background var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}
.dd-fix:hover { color: var(--bg); background: var(--g7); border-color: var(--g7); }
/* el pagador del día y los acreedores: matices, nunca protagonistas */
.d-paid, .dd-src, .p-to {
  font-size: var(--fs-1);
  color: var(--ink-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dd-sel {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  background: var(--bg-soft);
  border: 1px solid var(--ink);
  border-radius: var(--radius);
  padding: 0.25rem 0.5rem;
  min-height: var(--tap);
  min-width: 0;
}
.dd-edit { display: inline-flex; align-items: center; gap: var(--sp-1); min-width: 0; }
/* la salida que faltaba: sin ella el desplegable sólo se cerraba corrigiendo */
.dd-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: var(--tap);
  min-height: var(--tap);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  cursor: pointer;
  transition: color var(--dur-1), background var(--dur-1), border-color var(--dur-1);
}
.dd-x:hover { color: var(--bg); background: var(--g6); border-color: var(--g6); }

/* ---- por persona ---- */
.p-row, .o-row {
  display: grid;
  align-items: center;
  gap: 0.7rem;
  font-size: var(--fs-2);
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 0.6rem 0.8rem;
}
/* el gasto acumulado por persona crece con los meses: minmax(), no fijo */
.p-row { grid-template-columns: minmax(6rem, 1fr) 60px auto auto minmax(4.8rem, auto) auto; }
.p-who { min-width: 0; display: inline-flex; align-items: center; gap: 0.5ch; }

/* tu propia fila */
.p-row.mine, .o-row.mine { border-color: var(--ink-dim); background: var(--panel); }
.p-row.mine .p-name, .o-row.mine .p-name { font-weight: 700; }
.p-name { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p-bar, .o-bar { height: 6px; background: var(--line); border-radius: 999px; overflow: hidden; }
.p-fill, .o-fill {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-pill);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform var(--dur-4) var(--ease-out);
}
.p-fill { background: var(--ink-dim); }
.o-fill { background: var(--ink); }
.block.is-revealed .p-fill,
.block.is-revealed .o-fill { transform: scaleX(var(--fill, 0)); }
.p-num {
  color: var(--ink-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-num.spent { color: var(--ink); }
.p-pend {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15rem;
  text-align: right;
}
.p-ok { font-size: var(--fs-2); color: var(--g5); white-space: nowrap; }
.p-settle { color: var(--g6); border-color: color-mix(in srgb, var(--g6) 45%, var(--line-2)); white-space: nowrap; }
.p-settle:hover { color: var(--bg); background: var(--g6); border-color: var(--g6); }

@media (max-width: 720px) {
  .p-row { grid-template-columns: 1fr auto; row-gap: 0.4rem; }
  .p-bar { display: none; }
  .p-pend { grid-column: 1 / -1; text-align: left; }
}

/* ---- a quién le toca ---- */
.o-note { font-size: var(--fs-2); color: var(--ink-dim); margin-bottom: 0.9rem; }
.o-done {
  display: flex;
  align-items: center;
  gap: 0.5ch;
  flex-wrap: wrap;
  font-size: var(--fs-2);
  color: var(--ink-dim);
  border-left: 2px solid var(--g5);
  padding: 0.45rem 0.7rem;
  margin-bottom: 0.9rem;
  background: var(--bg-soft);
}
.o-done b { color: var(--ink); }
.o-row { grid-template-columns: minmax(6rem, 1fr) auto minmax(60px, 130px) 4rem; }
.o-gone { display: inline-flex; align-items: center; gap: 0.5ch; color: var(--ink-faint); font-size: var(--fs-2); }
.o-dots { display: inline-flex; gap: 2px; }
.o-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--ink-faint); }
.o-gone-n { white-space: nowrap; font-variant-numeric: tabular-nums; }
.o-row.away { opacity: 0.55; }
.o-row.away .p-name { text-decoration: line-through; }
.o-awaytxt {
  grid-column: 3 / -1;
  text-align: right;
  font-size: var(--fs-1);
  color: var(--g6);
  white-space: nowrap;
}
.o-pct {
  font-family: var(--crt);
  font-size: var(--fs-4);
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
