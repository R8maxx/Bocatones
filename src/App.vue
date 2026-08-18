<script setup>
import { computed, ref, watch } from 'vue'
import GlitchTitle from './components/GlitchTitle.vue'
import OrderForm from './components/OrderForm.vue'
import OrderList from './components/OrderList.vue'
import ThemePicker from './components/ThemePicker.vue'
import SlotMachine from './components/SlotMachine.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import PriceList from './components/PriceList.vue'
import { useOrders } from './composables/useOrders.js'
import { useDraw } from './composables/useDraw.js'
import { personEmoji } from './composables/usePersonEmoji.js'
import { fmt } from './money.js'
import { rtStatus } from './realtime.js'

const live = {
  online: { txt: 'EN DIRECTO', cls: 'on' },
  connecting: { txt: 'CONECTANDO', cls: 'wait' },
  offline: { txt: 'RECONECTANDO', cls: 'off' },
}
const liveState = computed(() => live[rtStatus.value] || live.offline)

const {
  orders, count, byFilling, loading, error, freshIds, arrival,
  debts, debtTotal, dayTotal, dayPending, dayPaidCount,
  addOrder, updateOrder, removeOrder, setPaid, settle, clearAll, buildPlainList,
} = useOrders()

// sorteo de quién recoge los bocatas (ponderado: quien menos ha ido, más papeletas)
const { open: slotOpen, round: slotRound, draw, winner, odds, openMachine, confirmDraw, closeDraw, toggleAvailable } =
  useDraw()

// vista actual: el día de hoy o el histórico. Sin router: una sola pantalla.
const view = ref('today')
const showPrices = ref(false)

function toggleView() {
  view.value = view.value === 'today' ? 'history' : 'today'
}

function askSettle(person, pending) {
  if (window.confirm(`¿Marcar como pagado todo lo que debe ${person} (${fmt(pending)})?`)) {
    settle(person)
  }
}

// al tirar de la palanca se pide el sorteo al servidor (y aparece en todas las pantallas)
function onPull() {
  confirmDraw().catch(() => closeDraw())
}

// personas distintas en la lista (no vacías) — candidatas al sorteo
const people = computed(() => {
  const seen = new Set()
  const out = []
  for (const o of orders.value) {
    const n = (o.person || '').trim()
    const k = n.toLowerCase()
    if (n && !seen.has(k)) {
      seen.add(k)
      out.push(n)
    }
  }
  return out
})
const canDraw = computed(() => people.value.length >= 2)

// aviso emergente cuando alguien añade o quita un pedido
const ADD_PHRASES = [
  '¡marchando!',
  '¡ñam ñam!',
  '¡otro pa’l bar!',
  '¡al canto!',
  '¡hay hambre!',
  '¡pedido fresquito!',
  '¡que no falte!',
  '¡toma bocata!',
]
const REMOVE_PHRASES = [
  'alguien se ha arrepentido…',
  'uno menos pa’l bar',
  'se lo pensó mejor',
  '¡fuera bocata!',
  'adiós muy buenas',
  'ya no hay tanta hambre',
  'se cayó del pedido',
  '¡ups, retirado!',
]
const toast = ref(null)
let addIdx = 0
let removeIdx = 0
let toastTimer = null
watch(arrival, (a) => {
  if (!a) return
  const isRemove = a.kind === 'remove'
  const phrase = isRemove
    ? REMOVE_PHRASES[removeIdx++ % REMOVE_PHRASES.length]
    : ADD_PHRASES[addIdx++ % ADD_PHRASES.length]
  toast.value = {
    ...a,
    remove: isRemove,
    phrase,
    emoji: isRemove ? '🗑️' : '🥪',
    verb: isRemove ? 'retira' : 'pide',
    sizeTxt: a.size === 'half' ? '½ ' : '',
  }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 4200)
})

// fecha de hoy
const todayLabel = computed(() =>
  new Date()
    .toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase(),
)

const max = computed(() => Math.max(1, ...byFilling.value.map((b) => b.n)))

// recuento compacto por relleno: enteros + medias
function sizeSummary(b) {
  const parts = []
  if (b.whole) parts.push(`${b.whole}`)
  if (b.half) parts.push(`½×${b.half}`)
  return parts.join(' + ')
}

// texto de extras (pan + notas) para el panel
function extraText(b) {
  const parts = []
  if (b.bread) parts.push(`pan: ${b.bread}`)
  if (b.notes) parts.push(b.notes)
  return parts.join(' · ')
}

// ---- copiar lista para el bar ----
const copied = ref(false)
let copyTimer = null

async function copyList() {
  if (count.value === 0) return
  const text = buildPlainList(todayLabel.value)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // fallback para navegadores/contextos sin Clipboard API
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {
      window.prompt('Copia la lista manualmente:', text)
    }
    document.body.removeChild(ta)
  }
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => (copied.value = false), 2200)
}

function confirmClear() {
  if (count.value === 0) return
  if (window.confirm('¿Vaciar todo el pedido? Esto no se puede deshacer.')) {
    clearAll()
  }
}
</script>

<template>
  <div class="page">
    <header class="hero">
      <div class="statusbar">
        <span class="dot" :class="liveState.cls" /> SISTEMA DE PEDIDOS · BAR · v1.0
        <span class="sep">|</span>
        <span class="live" :class="liveState.cls"><span class="blink">●</span> {{ liveState.txt }}</span>
      </div>

      <GlitchTitle text="BOCATONES" />

      <p class="tagline">
        <span class="bk">[</span> pedido del día <span class="bk">]</span>
        &nbsp;·&nbsp; {{ todayLabel }}
      </p>

      <ThemePicker />

      <nav class="nav">
        <button class="nav-btn" type="button" :class="{ on: view === 'history' }" @click="toggleView">
          {{ view === 'history' ? '← volver a hoy' : '📜 histórico' }}
        </button>
        <button class="nav-btn" type="button" @click="showPrices = true">€ precios</button>
      </nav>
    </header>

    <template v-if="view === 'today'">
    <main class="layout">
      <section class="col-form">
        <OrderForm @add="addOrder" />
      </section>

      <aside class="col-stats">
        <button v-if="winner" class="pick-card" type="button" title="Volver a sortear" @click="openMachine">
          <span class="pick-lbl">// hoy recoge</span>
          <span class="pick-who">
            <span class="pick-emoji">{{ personEmoji(winner.name) }}</span>
            <span class="pick-name">{{ winner.name }}</span>
          </span>
          <span class="pick-hint">🎰 sortear de nuevo</span>
        </button>

        <div class="stat-card">
          <div class="stat-num">{{ String(count).padStart(2, '0') }}</div>
          <div class="stat-lbl">{{ count === 1 ? 'bocata en cola' : 'bocatas en cola' }}</div>
        </div>

        <!-- dinero: lo de hoy y la deuda que se arrastra de otros días -->
        <div v-if="count || debts.length" class="money-card">
          <div class="money-head">// la cuenta</div>

          <div v-if="count" class="money-today">
            <span class="mt-row">
              <span class="mt-lbl">hoy</span>
              <span class="mt-val">{{ fmt(dayTotal) }}</span>
            </span>
            <span class="mt-row" :class="dayPending ? 'due' : 'ok'">
              <span class="mt-lbl">{{ dayPending ? 'sin pagar' : 'todo pagado' }}</span>
              <span class="mt-val">{{ dayPending ? fmt(dayPending) : '✓' }}</span>
            </span>
            <span class="mt-hint">{{ dayPaidCount }}/{{ count }} pedidos pagados</span>
          </div>

          <div v-if="debts.length" class="debts">
            <div class="debts-head">
              deuda acumulada <span class="debts-total">{{ fmt(debtTotal) }}</span>
            </div>
            <ul>
              <li v-for="d in debts" :key="d.name" class="debt-row">
                <span class="debt-who">
                  <span class="debt-emoji">{{ personEmoji(d.name) }}</span>
                  <span class="debt-name">{{ d.name }}</span>
                </span>
                <button
                  class="debt-amount"
                  type="button"
                  :title="`saldar la cuenta de ${d.name}`"
                  @click="askSettle(d.name, d.pending)"
                >{{ fmt(d.pending) }}</button>
              </li>
            </ul>
            <p class="debts-hint">// pulsa el importe para saldar</p>
          </div>
        </div>

        <div v-if="byFilling.length" class="tally">
          <div class="tally-head">// recuento para el bar</div>
          <ul>
            <li
              v-for="b in byFilling"
              :key="b.filling + '|' + b.bread + '|' + b.notes"
              class="tally-row"
            >
              <span class="t-name">
                <span class="t-filling">{{ b.filling }}</span>
                <small v-if="b.bread || b.notes" class="t-extra">{{ extraText(b) }}</small>
              </span>
              <span class="t-bar">
                <span class="t-fill" :style="{ width: (b.n / max) * 100 + '%' }" />
              </span>
              <span class="t-n">{{ sizeSummary(b) }}</span>
              <span class="t-money">{{ b.money ? fmt(b.money) : '' }}</span>
            </li>
          </ul>
        </div>
      </aside>
    </main>

    <section class="orders">
      <div class="orders-head">
        <h2>
          <span class="hash">#</span> cola de pedidos
          <span class="ct">[{{ count }}]</span>
        </h2>
        <div v-if="count" class="head-actions">
          <button
            class="draw"
            type="button"
            :disabled="!canDraw"
            :title="canDraw ? 'Sortear quién recoge los bocatas' : 'Hacen falta al menos 2 personas distintas'"
            @click="openMachine"
          >
            🎰 ¿quién recoge?
          </button>
          <button class="copy" type="button" :class="{ done: copied }" @click="copyList">
            <span aria-hidden="true">{{ copied ? '✓' : '⧉' }}</span>
            {{ copied ? 'copiado' : 'copiar lista' }}
          </button>
          <button class="clear" type="button" @click="confirmClear">rm -rf *</button>
        </div>
      </div>

      <p v-if="error" class="error">⚠ servidor no disponible — reintentando… ({{ error }})</p>

      <OrderList
        v-if="count"
        :orders="orders"
        :fresh-ids="freshIds"
        @remove="removeOrder"
        @update="updateOrder"
        @paid="setPaid"
      />

      <div v-else-if="loading" class="empty">
        <p>cargando pedido del día… <span class="blink">_</span></p>
      </div>

      <div v-else class="empty">
        <pre class="ascii">  ___________
 /  BOCATA   \   sin pedidos todavía.
 \___________/   sé el primero en pedir ↑</pre>
        <p>El cursor parpadea. El bar espera. <span class="blink">_</span></p>
      </div>
    </section>

    </template>

    <HistoryPanel v-else />

    <footer class="foot">
      <span>// lista del día compartida · guardada en el servidor</span>
      <span class="sep">·</span>
      <span>hecho con pan y código</span>
    </footer>

    <!-- aviso de pedido entrante: un bocata que cae con su bocadillo de cómic -->
    <Transition name="toast">
      <div v-if="toast" :key="toast.id" class="toast" :class="{ 'is-remove': toast.remove }" role="status" aria-live="polite">
        <div class="bocata" aria-hidden="true">{{ toast.emoji }}</div>
        <div class="bubble">
          <span class="bubble-tag">{{ toast.phrase }}</span>
          <span class="bubble-detail">
            <b>{{ toast.person || 'alguien' }}</b> {{ toast.verb }} {{ toast.sizeTxt }}{{ toast.filling }}
            <template v-if="toast.count > 1"> <i>(+{{ toast.count - 1 }} más)</i></template>
          </span>
          <span class="bubble-bar" aria-hidden="true" />
        </div>
      </div>
    </Transition>

    <!-- tragaperras: ¿quién recoge los bocatas? -->
    <SlotMachine
      v-if="slotOpen"
      :key="slotRound"
      :draw="draw"
      :people="people"
      :odds="odds"
      @close="closeDraw"
      @pull="onPull"
      @again="openMachine"
      @toggle="toggleAvailable"
    />

    <PriceList v-if="showPrices" @close="showPrices = false" />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: clamp(1.6rem, 4vw, 2.8rem);
  padding-block: clamp(1.2rem, 4vw, 2.5rem);
  animation: boot 0.5s ease both;
}
@keyframes boot {
  from { opacity: 0; transform: translateY(8px); }
}

/* ---- hero ---- */
.hero { text-align: center; }
.statusbar {
  display: inline-flex;
  align-items: center;
  gap: 0.6ch;
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  color: var(--ink-dim);
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 0.3rem 0.9rem;
  margin-bottom: 1.4rem;
}
.statusbar .sep { color: var(--ink-faint); }
.dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--ink-faint);
  transition: background 0.3s, box-shadow 0.3s;
}
.dot.on  { background: var(--g5); box-shadow: 0 0 8px var(--g5); }
.dot.wait { background: var(--g3); box-shadow: 0 0 8px var(--g3); }
.dot.off { background: var(--g1); box-shadow: 0 0 8px var(--g1); }

.live { display: inline-flex; align-items: center; gap: 0.5ch; }
.live.on  { color: var(--ink); }
.live.wait { color: var(--ink-dim); }
.live.off { color: var(--g1); }
.live .blink { color: inherit; }

.blink { animation: blink 1s steps(1) infinite; color: var(--ink); }
@keyframes blink { 50% { opacity: 0.15; } }

.tagline {
  margin-top: 1.1rem;
  font-size: clamp(0.78rem, 2vw, 0.95rem);
  letter-spacing: 0.08em;
  color: var(--ink-dim);
}
.tagline .bk { color: var(--ink-faint); }

/* ---- navegación: hoy / histórico / precios ---- */
.nav {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1.1rem;
}
.nav-btn {
  font-family: var(--mono);
  font-size: 0.76rem;
  letter-spacing: 0.04em;
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 0.34rem 0.9rem;
  cursor: pointer;
  transition: all 0.15s;
}
.nav-btn:hover { color: var(--ink); border-color: var(--ink-dim); }
.nav-btn.on {
  color: var(--bg);
  background: var(--ink);
  border-color: var(--ink);
  font-weight: 700;
}

/* ---- layout ---- */
.layout {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 1.3rem;
  align-items: start;
}
@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; }
}

/* ---- stats ---- */
.col-stats { display: flex; flex-direction: column; gap: 1rem; }

/* tarjeta de quién recoge hoy (resultado del sorteo, persiste en el menú) */
.pick-card {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  width: 100%;
  text-align: left;
  cursor: pointer;
  border: 1px solid var(--g5);
  border-radius: var(--radius);
  padding: 1rem 1.2rem;
  background:
    radial-gradient(120% 120% at 0% 0%, rgba(47, 143, 62, 0.14), transparent 60%),
    var(--panel);
  box-shadow: 0 0 22px -8px var(--g5);
  transition: box-shadow 0.18s, transform 0.18s;
}
.pick-card:hover { box-shadow: 0 0 26px -4px var(--g5); transform: translateY(-1px); }
.pick-lbl {
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.pick-who { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
.pick-emoji { font-size: 2rem; line-height: 1; flex-shrink: 0; }
.pick-name {
  font-family: var(--crt);
  font-size: 1.9rem;
  line-height: 1;
  color: var(--ink);
  text-shadow: 0 0 14px rgba(255, 255, 255, 0.22);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pick-hint { font-size: 0.7rem; color: var(--ink-dim); letter-spacing: 0.04em; }
.stat-card {
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 1.2rem 1.3rem;
  background:
    radial-gradient(120% 120% at 100% 0%, rgba(255,255,255,0.04), transparent 60%),
    var(--panel);
}
.stat-num {
  font-family: var(--crt);
  font-size: 4.2rem;
  line-height: 0.85;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 20px rgba(255,255,255,0.18);
}
.stat-lbl {
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-dim);
  margin-top: 0.5rem;
}

/* ---- la cuenta: dinero de hoy + deuda arrastrada ---- */
.money-card {
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
  background: var(--panel);
}
.money-head {
  font-size: 0.72rem;
  color: var(--ink-faint);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.8rem;
}
.money-today { display: flex; flex-direction: column; gap: 0.3rem; }
.mt-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
  font-size: 0.84rem;
  color: var(--ink-dim);
}
.mt-val { font-variant-numeric: tabular-nums; color: var(--ink); }
.mt-row.due .mt-lbl, .mt-row.due .mt-val { color: var(--g6); font-weight: 700; }
.mt-row.ok .mt-lbl, .mt-row.ok .mt-val { color: var(--g5); }
.mt-hint { font-size: 0.68rem; color: var(--ink-faint); margin-top: 0.15rem; }

.debts { margin-top: 1rem; padding-top: 0.85rem; border-top: 1px dashed var(--line-2); }
.debts-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.7rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--ink-faint);
  margin-bottom: 0.6rem;
}
.debts-total { color: var(--g6); font-weight: 700; font-variant-numeric: tabular-nums; }
.debts ul { list-style: none; display: flex; flex-direction: column; gap: 0.35rem; }
.debt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.82rem;
}
.debt-who { min-width: 0; display: inline-flex; align-items: center; gap: 0.5ch; }
.debt-emoji { font-size: 1.05rem; line-height: 1; }
.debt-name {
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.debt-amount {
  font-family: var(--mono);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  color: var(--g6);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--g6) 40%, var(--line-2));
  border-radius: 999px;
  padding: 0.16rem 0.55rem;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.debt-amount:hover { color: var(--bg); background: var(--g6); border-color: var(--g6); }
.debts-hint { font-size: 0.66rem; color: var(--ink-faint); margin-top: 0.55rem; }

.tally {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
  background: var(--bg-soft);
}
.tally-head {
  font-size: 0.72rem;
  color: var(--ink-faint);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.8rem;
}
.tally ul { list-style: none; display: flex; flex-direction: column; gap: 0.55rem; }
.tally-row {
  display: grid;
  grid-template-columns: 1fr 40px auto auto;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.8rem;
}
.t-name { min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.t-filling {
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.t-extra {
  font-size: 0.68rem;
  color: var(--ink-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.t-bar {
  height: 6px;
  background: var(--line);
  border-radius: 999px;
  overflow: hidden;
}
.t-fill {
  display: block;
  height: 100%;
  background: var(--ink);
  border-radius: 999px;
  transition: width 0.4s ease;
}
.t-n { color: var(--ink-dim); font-variant-numeric: tabular-nums; }
.t-money {
  color: var(--ink-faint);
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

/* ---- orders ---- */
.orders-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.7rem 1rem;
  margin-bottom: 1.1rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid var(--line-2);
}
.orders-head h2 {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.hash { color: var(--ink-faint); }
.ct { color: var(--ink-dim); font-weight: 400; }
.head-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.draw {
  font-family: var(--mono);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--ink);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.4rem 0.85rem;
  cursor: pointer;
  transition: all 0.15s;
}
.draw:hover:not(:disabled) {
  border-color: var(--g3);
  box-shadow: 0 0 18px -6px var(--g3);
}
.draw:disabled { opacity: 0.4; cursor: not-allowed; }
.copy {
  display: inline-flex;
  align-items: center;
  gap: 0.5ch;
  font-family: var(--mono);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--bg);
  background: var(--ink);
  border: 1px solid var(--ink);
  border-radius: var(--radius);
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  transition: all 0.18s;
}
.copy:hover { box-shadow: 0 0 22px -4px rgba(255, 255, 255, 0.5); }
.copy.done {
  color: var(--g5);
  background: transparent;
  border-color: var(--g5);
  box-shadow: none;
}
.clear {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.4rem 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
}
.clear:hover {
  color: var(--g1);
  border-color: var(--g1);
}

/* ---- error ---- */
.error {
  font-size: 0.8rem;
  color: var(--g6);
  border: 1px solid var(--g6);
  border-radius: var(--radius);
  padding: 0.6rem 0.9rem;
  margin-bottom: 1rem;
  background: rgba(212, 105, 30, 0.08);
}

/* ---- empty ---- */
.empty {
  text-align: center;
  padding: 2.5rem 1rem;
  color: var(--ink-dim);
}
.ascii {
  display: inline-block;
  font-family: var(--mono);
  font-size: 0.82rem;
  line-height: 1.5;
  color: var(--ink-faint);
  text-align: left;
  margin-bottom: 1rem;
}
.empty p { font-size: 0.88rem; }

/* ---- footer ---- */
.foot {
  display: flex;
  gap: 0.8ch;
  justify-content: center;
  flex-wrap: wrap;
  font-size: 0.72rem;
  color: var(--ink-faint);
  letter-spacing: 0.05em;
  padding-top: 1rem;
  border-top: 1px dashed var(--line);
}
.foot .sep { color: var(--line-2); }

/* ---- aviso: bocata con bocadillo de cómic ---- */
.toast {
  position: fixed;
  right: clamp(0.8rem, 3vw, 1.6rem);
  top: clamp(0.8rem, 3vw, 1.6rem);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  max-width: min(92vw, 380px);
  background: transparent; /* sin caja: el protagonista es el bocata */
  pointer-events: none;
}

/* el bocata cae dando un bote y luego se balancea */
.bocata {
  font-size: 3rem;
  line-height: 1;
  flex-shrink: 0;
  transform-origin: 50% 80%;
  filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.55));
  animation:
    drop 0.7s cubic-bezier(0.3, 1.4, 0.5, 1),
    swing 1.6s ease-in-out 0.7s infinite;
}
@keyframes drop {
  0% { transform: translateY(-150%) rotate(-25deg); opacity: 0; }
  60% { transform: translateY(8%) rotate(8deg); opacity: 1; }
  80% { transform: translateY(-4%) rotate(-4deg); }
  100% { transform: translateY(0) rotate(0); }
}
@keyframes swing {
  0%, 100% { transform: rotate(-5deg); }
  50% { transform: rotate(5deg); }
}

/* en una baja, el icono niega con la cabeza en vez de balancearse */
.toast.is-remove .bocata {
  animation:
    drop 0.7s cubic-bezier(0.3, 1.4, 0.5, 1),
    shake 0.45s ease-in-out 0.7s 2;
}
@keyframes shake {
  0%, 100% { transform: rotate(0); }
  25% { transform: rotate(-13deg); }
  75% { transform: rotate(13deg); }
}

/* las bajas van en rojo tenue para distinguirlas de un vistazo */
.toast.is-remove .bubble {
  background: #7d2b33;
  color: #ffe9e9;
  box-shadow: 0 14px 36px -16px #000, 0 0 22px -8px #b5505a;
}
.toast.is-remove .bubble::before {
  border-right-color: #7d2b33;
}
.toast.is-remove .bubble-bar {
  background: #ffe9e9;
}

/* bocadillo de cómic con rabito apuntando al bocata */
.bubble {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.7rem 0.95rem;
  background: var(--ink);
  color: var(--bg);
  border-radius: 14px;
  box-shadow: 0 14px 36px -16px #000;
  overflow: hidden;
  animation: pop 0.4s 0.18s cubic-bezier(0.2, 1.5, 0.4, 1) backwards;
}
/* rabito triangular hacia el bocata (a la izquierda) */
.bubble::before {
  content: '';
  position: absolute;
  left: -7px;
  top: 50%;
  transform: translateY(-50%);
  border: 7px solid transparent;
  border-right-color: var(--ink);
  border-left: 0;
}
@keyframes pop {
  from { transform: scale(0.4); opacity: 0; }
}

.bubble-tag {
  font-family: var(--crt);
  font-size: 1.35rem;
  line-height: 0.95;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.bubble-detail {
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.82;
}
.bubble-detail b { font-weight: 700; opacity: 1; }
.bubble-detail i { font-style: normal; opacity: 0.7; }

/* barra de tiempo que se vacía dentro del bocadillo */
.bubble-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  width: 100%;
  background: var(--bg);
  opacity: 0.35;
  transform-origin: left;
  animation: drain 4.2s linear forwards;
}
@keyframes drain { to { transform: scaleX(0); } }

/* entrada/salida del conjunto */
.toast-enter-active { transition: transform 0.35s cubic-bezier(0.2, 0.9, 0.2, 1), opacity 0.35s; }
.toast-leave-active { transition: transform 0.35s ease, opacity 0.35s; }
.toast-enter-from { transform: translateX(30px); opacity: 0; }
.toast-leave-to { transform: translateX(20px) scale(0.95); opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .bocata, .bubble, .bubble-bar { animation: none; }
}
</style>