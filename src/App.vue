<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GlitchTitle from './components/GlitchTitle.vue'
import OrderForm from './components/OrderForm.vue'
import OrderList from './components/OrderList.vue'
import ThemePicker from './components/ThemePicker.vue'
import SlotMachine from './components/SlotMachine.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import PriceList from './components/PriceList.vue'
import Notices from './components/Notices.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import MoneyValue from './components/MoneyValue.vue'
import { useOrders } from './composables/useOrders.js'
import { useDraw } from './composables/useDraw.js'
import { personEmoji } from './composables/usePersonEmoji.js'
import { fmt } from './money.js'
import { confirmSettle, confirmCollect } from './composables/useSettle.js'
import { usePayer } from './composables/usePayer.js'
import { useMe } from './composables/useMe.js'
import { rtStatus, isOnline } from './realtime.js'
import { confirm, useConfirm } from './composables/useConfirm.js'

const { isMe } = useMe()

// el diálogo propio que ha sustituido a los window.confirm
const { pending: confirmPending } = useConfirm()

const live = {
  online: { txt: 'EN DIRECTO', cls: 'on' },
  connecting: { txt: 'CONECTANDO', cls: 'wait' },
  offline: { txt: 'RECONECTANDO', cls: 'off' },
}
// sin red gana al estado del WebSocket: instalada como PWA la app abre desde la
// caché, y "RECONECTANDO" a secas no explica que el problema es del dispositivo
const liveState = computed(() =>
  isOnline.value ? live[rtStatus.value] || live.offline : { txt: 'SIN RED', cls: 'off' },
)

const {
  orders, count, byFilling, loading, error, freshIds, arrival,
  debts, debtTotal, dayTotal, dayPending, dayPaidCount,
  iOwe, owedToMe, iOweTotal, myUnmarked, orphanTotal, creditorsOf,
  addOrder, updateOrder, removeOrder, setPaid, settle, clearAll, buildPlainList,
} = useOrders()

// quién pone el dinero hoy: por defecto quien recoge, corregible a mano
const { payer, setPayer } = usePayer()

// corrector del pagador: mismo patrón que el «✎ corregir» del histórico
// (texto → botón → select), para que se aprenda una sola vez
const editingPayer = ref(false)
function choosePayer(e) {
  editingPayer.value = false
  setPayer(e.target.value) // '' = volver a seguir al sorteo
}

// sorteo de quién recoge los bocatas (ponderado: quien menos ha ido, más papeletas)
const { open: slotOpen, round: slotRound, draw, winner, odds, openMachine, confirmDraw, closeDraw, toggleAvailable } =
  useDraw()

/*
 * Barra compacta. La cabecera se comía el 54% de la primera pantalla y la cola
 * de pedidos empezaba por debajo del pliegue: no se veía ni una fila al cargar.
 * Ahora, cuando el centinela del final del hero sale de pantalla, aparece una
 * barra fina que conserva lo que importa: quién recoge y lo que queda por pagar.
 *
 * Se usa IntersectionObserver, no el evento scroll: no hay listener por frame.
 */
const sentinel = ref(null)
const compact = ref(false)
let io = null

onMounted(() => {
  if (!('IntersectionObserver' in window) || !sentinel.value) return
  io = new IntersectionObserver(([e]) => (compact.value = !e.isIntersecting), {
    threshold: 0,
    rootMargin: '-8px 0px 0px 0px',
  })
  io.observe(sentinel.value)
})
onBeforeUnmount(() => io?.disconnect())

// vista actual: el día de hoy o el histórico. Sin router: una sola pantalla.
const view = ref('today')
const showPrices = ref(false)

// si llega un sorteo de otra pantalla mientras edito precios, cierro el editor:
// dos diálogos modales a la vez dejan el foco y el Escape en tierra de nadie
watch(slotOpen, (open) => {
  if (open) showPrices.value = false
})

function toggleView() {
  view.value = view.value === 'today' ? 'history' : 'today'
}

// el formulario espera saber si el pedido se ha guardado antes de vaciarse
async function onAdd(fields, { resolve, reject }) {
  try {
    resolve(await addOrder(fields))
  } catch (e) {
    reject(e)
  }
}

// cobrar: solo lo que te deben A TI, no todo lo que esa persona debe
async function askCollect(row) {
  if (await confirmCollect(row.debtor, row.pending)) {
    settle(row.debtor, null, row.creditor).catch(() => {})
  }
}

async function askSettle(person, pending) {
  if (await confirmSettle(person, pending)) settle(person).catch(() => {})
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
      // último recurso: se le da el texto para que lo seleccione a mano
      confirm({
        title: 'copiar a mano',
        text: 'Tu navegador no ha dejado copiar la lista. Selecciónala y cópiala:',
        code: text,
        onlyOk: true,
        confirmLabel: 'cerrar',
      })
    }
    document.body.removeChild(ta)
  }
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => (copied.value = false), 2200)
}
</script>

<template>
  <div class="page">
    <header class="hero">
      <!-- una sola fila: estado, navegación y tema. Antes eran tres apiladas. -->
      <div class="topbar">
        <div class="statusbar">
          <span class="dot" :class="liveState.cls" aria-hidden="true" /> BAR · v1.0
          <span class="sep" aria-hidden="true">|</span>
          <span class="live" :class="liveState.cls"><span class="blink" aria-hidden="true">●</span> {{ liveState.txt }}</span>
        </div>

        <nav class="nav" aria-label="Vistas">
          <button
            class="nav-btn"
            type="button"
            :class="{ on: view === 'history' }"
            :aria-current="view === 'history' ? 'page' : undefined"
            @click="toggleView"
          >
            {{ view === 'history' ? '← volver a hoy' : '📜 histórico' }}
          </button>
          <button class="nav-btn" type="button" @click="showPrices = true">€ precios</button>
        </nav>

        <ThemePicker />
      </div>

      <GlitchTitle text="BOCATONES" />

      <p class="tagline">
        <span class="bk" aria-hidden="true">[</span> pedido del día <span class="bk" aria-hidden="true">]</span>
        &nbsp;·&nbsp; {{ todayLabel }}
      </p>

      <!-- centinela: marca el final de la cabecera -->
      <div ref="sentinel" class="sentinel" aria-hidden="true" />
    </header>

    <!--
      La barra va teleportada a `body`: .page conserva un transform resuelto de
      su animación de arranque (`boot ... both`), y un ancestro con transform se
      convierte en el bloque contenedor de sus descendientes `fixed`. Dentro de
      .page la barra medía 1000px en vez de todo el ancho de la ventana.
    -->
    <Teleport to="body">
      <div class="stickybar" :class="{ show: compact }">
        <span class="sb-brand">&lt;BOCATONES/&gt;</span>
        <span v-if="winner" class="sb-who">
          <span aria-hidden="true">{{ personEmoji(winner.name) }}</span>
          recoge <b>{{ winner.name }}</b>
        </span>
        <span v-if="dayPending" class="sb-due">
          sin pagar <MoneyValue :cents="dayPending" />
        </span>
        <span
          v-if="iOweTotal"
          class="sb-owe"
          :title="iOwe.map((r) => `${r.creditor}: ${fmt(r.pending)}`).join(' · ')"
        >
          debes <MoneyValue :cents="iOweTotal" />
        </span>
        <span class="sb-actions">
          <button class="sb-btn" type="button" @click="toggleView">
            {{ view === 'history' ? '← hoy' : '📜 histórico' }}
          </button>
          <button class="sb-btn" type="button" @click="showPrices = true">€ precios</button>
        </span>
      </div>
    </Teleport>

    <main>
    <template v-if="view === 'today'">
    <div class="layout">
      <section class="col-form" aria-label="Nuevo pedido">
        <OrderForm @add="onAdd" />
      </section>

      <aside class="col-stats">
        <button v-if="winner" class="pick-card" type="button" title="Volver a sortear" @click="openMachine">
          <span class="pick-lbl">// hoy recoge</span>
          <span class="pick-who">
            <span class="pick-emoji" aria-hidden="true">{{ personEmoji(winner.name) }}</span>
            <span class="pick-name">{{ winner.name }}</span>
          </span>
          <span class="pick-hint">🎰 sortear de nuevo</span>
        </button>

        <div class="stat-card">
          <div class="stat-num">{{ String(count).padStart(2, '0') }}</div>
          <div class="stat-lbl">{{ count === 1 ? 'bocata en cola' : 'bocatas en cola' }}</div>
        </div>

        <!-- dinero: lo de hoy y la deuda que se arrastra de otros días -->
        <div v-if="count || debts.length || payer" class="money-card">
          <h2 class="money-head">// la cuenta</h2>

          <!-- quién pone el dinero hoy: por defecto quien recoge, corregible -->
          <div class="pay-row">
            <span class="pay-lbl">hoy paga</span>
            <template v-if="!editingPayer">
              <span class="pay-who">
                <span class="pay-emoji" aria-hidden="true">{{ payer ? personEmoji(payer.name) : '❔' }}</span>
                <span class="pay-txt">
                  <span class="pay-name">{{ payer ? payer.name : 'nadie, por ahora' }}</span>
                  <small v-if="payer?.source === 'draw'" class="pay-src">// quien recoge</small>
                  <small v-else-if="payer" class="pay-src">// fijado a mano</small>
                  <small v-else class="pay-src">// nadie ha puesto el dinero</small>
                </span>
              </span>
              <button class="pay-fix" type="button" @click="editingPayer = true">✎ cambiar</button>
            </template>
            <select v-else class="pay-sel" aria-label="quién pone el dinero hoy" @change="choosePayer">
              <option value="">— que lo diga el sorteo —</option>
              <option v-for="p in people" :key="p" :value="p">{{ p }}</option>
            </select>
          </div>

          <div v-if="count" class="money-today">
            <span class="mt-row">
              <span class="mt-lbl">hoy</span>
              <span class="mt-val"><MoneyValue :cents="dayTotal" /></span>
            </span>
            <span class="mt-row" :class="dayPending ? 'due' : 'ok'">
              <span class="mt-lbl">{{ dayPending ? 'sin pagar' : 'todo pagado' }}</span>
              <span class="mt-val">
                <MoneyValue v-if="dayPending" :cents="dayPending" />
                <template v-else>✓</template>
              </span>
            </span>
            <span class="mt-hint">{{ dayPaidCount }}/{{ count }} pedidos pagados</span>
          </div>

          <!-- tu posición en la cuenta: con nombre y apellidos, no un total ciego -->
          <div v-if="iOwe.length || owedToMe.length || myUnmarked.length" class="mine-money">
            <p v-for="r in iOwe" :key="'owe-' + r.creditorKey" class="mm-row owe">
              <span>debes <MoneyValue :cents="r.pending" /> a</span>
              <span class="mm-emoji" aria-hidden="true">{{ personEmoji(r.creditor) }}</span>
              <b>{{ r.creditor }}</b>
              <small v-if="r.days > 1">· {{ r.days }} días</small>
            </p>
            <p v-for="r in owedToMe" :key="'owed-' + r.debtorKey" class="mm-row owed">
              <span>te debe <MoneyValue :cents="r.pending" /></span>
              <span class="mm-emoji" aria-hidden="true">{{ personEmoji(r.debtor) }}</span>
              <b>{{ r.debtor }}</b>
              <button class="mm-btn" type="button" @click="askCollect(r)">✓ cobrado</button>
            </p>
            <p v-for="r in myUnmarked" :key="'self-' + r.debtorKey" class="mm-row self">
              <span>pusiste el dinero: tu <MoneyValue :cents="r.pending" /> sigue sin marcar</span>
              <button class="mm-btn" type="button" @click="askCollect(r)">✓ marcar</button>
            </p>
          </div>

          <div v-if="debts.length" class="debts">
            <h3 class="debts-head">
              deuda acumulada <span class="debts-total"><MoneyValue :cents="debtTotal" /></span>
            </h3>
            <ul>
              <li v-for="d in debts" :key="d.key" class="debt-row" :class="{ mine: isMe(d.name) }">
                <span class="debt-who">
                  <span class="debt-emoji" aria-hidden="true">{{ personEmoji(d.name) }}</span>
                  <span class="debt-txt">
                    <span class="debt-name">
                      {{ d.name }}<span v-if="isMe(d.name)" class="mine-tag"> « tú »</span>
                    </span>
                    <small v-if="creditorsOf(d.key).length" class="debt-to">
                      → a {{ creditorsOf(d.key).map((c) => `${c.creditor} ${fmt(c.pending)}`).join(' · ') }}
                    </small>
                  </span>
                </span>
                <button
                  class="debt-amount"
                  type="button"
                  :title="`saldar la cuenta de ${d.name}`"
                  @click="askSettle(d.name, d.pending)"
                ><MoneyValue :cents="d.pending" /></button>
              </li>
            </ul>
            <p class="debts-hint">// pulsa el importe para saldar</p>
            <p v-if="orphanTotal" class="debts-orphan">
              ⚠ <MoneyValue :cents="orphanTotal" /> de días sin pagador — apunta quién puso el dinero
            </p>
          </div>

          <p v-else-if="count" class="debts-clear">✓ nadie arrastra deuda de otros días</p>
        </div>

        <div v-if="byFilling.length" v-reveal class="tally">
          <h2 class="tally-head">// recuento para el bar</h2>
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
              <span class="t-bar" aria-hidden="true">
                <span class="t-fill" :style="{ '--fill': b.n / max }" />
              </span>
              <span class="t-n">{{ sizeSummary(b) }}</span>
              <span class="t-money"><MoneyValue v-if="b.money" :cents="b.money" /></span>
            </li>
          </ul>
        </div>
      </aside>
    </div>

    <section class="orders" aria-labelledby="orders-title">
      <div class="orders-head">
        <h2 id="orders-title">
          <span class="hash" aria-hidden="true">#</span> cola de pedidos
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
          <button
            class="clear"
            type="button"
            title="Vaciar el pedido del día — se puede deshacer"
            @click="clearAll"
          >rm -rf *</button>
        </div>
      </div>

      <p v-if="error" class="error" role="alert">⚠ servidor no disponible — reintentando… ({{ error }})</p>

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
        <pre class="ascii" aria-hidden="true">  ___________
 /  BOCATA   \   sin pedidos todavía.
 \___________/   sé el primero en pedir ↑</pre>
        <p>El cursor parpadea. El bar espera. <span class="blink">_</span></p>
      </div>
    </section>

    </template>

    <HistoryPanel v-else />
    </main>

    <footer class="foot">
      <p class="foot-line">
        <span>// lista del día compartida · guardada en el servidor</span>
        <span class="sep" aria-hidden="true">·</span>
        <span>hecho con pan y código</span>
      </p>

      <p class="credit">
        <img
          class="credit-logo"
          src="/rm-technology-64.png"
          srcset="/rm-technology-64.png 1x, /rm-technology-128.png 2x"
          width="24"
          height="24"
          alt="Logotipo de RM Technology"
          loading="lazy"
          decoding="async"
        />
        <span>Design by <b>RM Technology</b></span>
      </p>
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

    <!--
      Pregunta antes de actuar (saldar, cobrar…). Se monta y desmonta con la
      pregunta, como PriceList: useModal engancha el foco y el Escape al montar.
      El :key fuerza el remontaje si una pregunta reemplaza a otra.
    -->
    <ConfirmDialog v-if="confirmPending" :key="confirmPending.id" />

    <!-- avisos del sistema: errores, confirmaciones y deshacer -->
    <Notices />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: clamp(1.1rem, 2.6vw, 1.9rem);
  padding-block: clamp(0.8rem, 2vw, 1.4rem);
  animation: boot 0.5s ease both;
}
@keyframes boot {
  from { opacity: 0; transform: translateY(8px); }
}

/* ---- hero ---- */
.hero { text-align: center; }

/* estado + navegación + tema en una sola línea */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-2) var(--sp-3);
  margin-bottom: var(--sp-3);
}
@media (max-width: 720px) {
  .topbar { justify-content: center; }
}

.statusbar {
  display: inline-flex;
  align-items: center;
  gap: 0.6ch;
  font-size: var(--fs-1);
  letter-spacing: 0.12em;
  color: var(--ink-dim);
  border: 1px solid var(--line-2);
  border-radius: var(--radius-pill);
  padding: 0.28rem 0.8rem;
}

.sentinel { height: 1px; }

/* ---- barra compacta ---- */
.stickybar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-toast);
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) clamp(0.8rem, 3vw, 2rem);
  font-size: var(--fs-2);
  color: var(--ink-dim);
  background: var(--panel);
  border-bottom: 1px solid var(--line-2);
  box-shadow: var(--shadow-md);
  transform: translateY(-100%);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.28s cubic-bezier(0.2, 0.9, 0.2, 1), opacity 0.28s;
}
.stickybar.show {
  transform: translateY(0);
  opacity: 1;
  pointer-events: auto;
}
.sb-brand {
  font-family: var(--crt);
  font-size: var(--fs-4);
  line-height: 1;
  color: var(--ink);
  white-space: nowrap;
}
.sb-who, .sb-due, .sb-owe { display: inline-flex; align-items: center; gap: 0.5ch; white-space: nowrap; }
.sb-who b { color: var(--ink); }
.sb-due, .sb-owe { color: var(--g6); font-weight: 700; }
.sb-actions { margin-left: auto; display: flex; gap: var(--sp-1); }
.sb-btn {
  font-family: var(--mono);
  font-size: var(--fs-1);
  letter-spacing: 0.04em;
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-pill);
  padding: 0.3rem 0.75rem;
  min-height: var(--tap);
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s, border-color 0.15s;
}
.sb-btn:hover { color: var(--ink); border-color: var(--ink-dim); }

@media (max-width: 620px) {
  .sb-who, .sb-due, .sb-owe { font-size: var(--fs-1); }
  .sb-brand { display: none; }
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
  margin-top: var(--sp-2);
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
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 0.34rem 0.9rem;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.nav-btn:hover { color: var(--ink); border-color: var(--ink-dim); }
.nav-btn.on {
  color: var(--bg);
  background: var(--ink);
  border-color: var(--ink);
  font-weight: 700;
}

/*
 * <main> envuelve las dos vistas para que el documento no se quede sin landmark
 * principal en el histórico. Al meterlo, .layout y .orders dejaron de ser hijos
 * de .page y perdieron su `gap`: la tarjeta del recuento acababa pegada a los
 * botones de la cola, sin un pixel de separación. Aquí se les devuelve el ritmo.
 */
main {
  display: flex;
  flex-direction: column;
  gap: clamp(1.1rem, 2.6vw, 1.9rem);
}

/* algo más de aire del que da el gap: encima acaba una tarjeta y debajo empieza
   una fila de botones, y eso necesita más separación que dos bloques de texto */
.orders { margin-top: var(--sp-2); }

/* ---- layout ---- */
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
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
    radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--g5) 14%, transparent), transparent 60%),
    var(--panel);
  box-shadow: 0 0 22px -8px var(--g5);
  transition: box-shadow 0.18s, transform 0.18s;
}
.pick-card:hover { box-shadow: 0 0 26px -4px var(--g5); transform: translateY(-1px); }
.pick-lbl {
  font-size: var(--fs-2);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.pick-who { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
.pick-emoji { font-size: 2rem; line-height: 1; flex-shrink: 0; }
.pick-name {
  font-family: var(--crt);
  font-size: var(--fs-6);
  line-height: 1;
  color: var(--ink);
  text-shadow: 0 0 14px var(--glow-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pick-hint { font-size: var(--fs-1); color: var(--ink-dim); letter-spacing: 0.04em; }
.stat-card {
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: var(--sp-3) var(--sp-4);
  background:
    radial-gradient(120% 120% at 100% 0%, var(--glow-soft), transparent 60%),
    var(--panel);
}
.stat-num {
  font-family: var(--crt);
  font-size: var(--fs-7);
  line-height: 0.85;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 20px var(--glow-soft);
}
.stat-lbl {
  font-size: var(--fs-2);
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
  font-size: var(--fs-2);
  color: var(--ink-faint);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.8rem;
}
/* ---- hoy paga: el acreedor del día ---- */
.pay-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem 0.8rem;
  padding-bottom: 0.8rem;
  margin-bottom: 0.8rem;
  border-bottom: 1px dashed var(--line-2);
}
.pay-lbl {
  font-size: var(--fs-2);
  color: var(--ink-dim);
}
.pay-who { display: inline-flex; align-items: center; gap: 0.6ch; min-width: 0; }
.pay-emoji { font-size: var(--fs-4); line-height: 1; flex-shrink: 0; }
.pay-txt { min-width: 0; display: flex; flex-direction: column; }
.pay-name {
  color: var(--ink);
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pay-src { font-size: var(--fs-1); color: var(--ink-faint); }
/* mismas piezas que el corrector del histórico (.dd-fix / .dd-sel): el gesto
   "texto → ✎ → select" se aprende una vez y vale en las dos pantallas */
.pay-fix {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  font-family: var(--mono);
  font-size: var(--fs-1);
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-pill);
  padding: 0.2rem 0.6rem;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.pay-fix:hover { color: var(--bg); background: var(--g7); border-color: var(--g7); }
.pay-sel {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  background: var(--bg-soft);
  border: 1px solid var(--ink);
  border-radius: var(--radius);
  padding: 0.25rem 0.5rem;
  max-width: 100%;
}

/* ---- tu posición: a quién le debes y quién te debe ---- */
.mine-money {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.85rem;
}
.mm-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5ch;
  font-size: var(--fs-2);
  color: var(--ink-dim);
  padding-left: 0.6rem;
  border-left: 2px solid var(--line-2);
}
.mm-row b { color: var(--ink); }
.mm-row small { color: var(--ink-faint); }
.mm-emoji { font-size: var(--fs-3); line-height: 1; }
/* deuda es deuda se mire desde donde se mire: el naranja no cambia de bando,
   la dirección la dicen la palabra y el borde */
.mm-row.owe { border-left-color: var(--g6); }
.mm-row.owe :deep(.money) { color: var(--g6); font-weight: 700; }
.mm-row.owed :deep(.money) { color: var(--g6); font-weight: 700; }
.mm-row.self { border-left-color: var(--g3); }
.mm-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  font-family: var(--mono);
  font-size: var(--fs-1);
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: var(--radius-pill);
  padding: 0.16rem 0.55rem;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
/* la acción RESULTA en "pagado": ahí sí toca el verde */
.mm-btn:hover { color: var(--bg); background: var(--g5); border-color: var(--g5); }

.money-today { display: flex; flex-direction: column; gap: 0.3rem; }
.mt-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
  font-size: var(--fs-3);
  color: var(--ink-dim);
}
.mt-val { font-variant-numeric: tabular-nums; color: var(--ink); }
.mt-row.due .mt-lbl, .mt-row.due .mt-val { color: var(--g6); font-weight: 700; }
.mt-row.ok .mt-lbl, .mt-row.ok .mt-val { color: var(--g5); }
.mt-hint { font-size: var(--fs-1); color: var(--ink-faint); margin-top: 0.15rem; }

.debts { margin-top: 1rem; padding-top: 0.85rem; border-top: 1px dashed var(--line-2); }
.debts-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.7rem;
  font-size: var(--fs-1);
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
  font-size: var(--fs-2);
}
.debt-who { min-width: 0; display: inline-flex; align-items: center; gap: 0.5ch; }
/* el nombre y su acreedor, en columna: "→ a Marta" no cabe en la misma línea */
.debt-txt { min-width: 0; display: flex; flex-direction: column; }
.debt-to {
  font-size: var(--fs-1);
  color: var(--ink-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.debt-emoji { font-size: var(--fs-4); line-height: 1; }
.debt-name {
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.debt-row.mine .debt-name { font-weight: 700; }
.mine-tag { font-size: var(--fs-1); color: var(--ink-dim); white-space: nowrap; }

.debt-amount {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-variant-numeric: tabular-nums;
  color: var(--g6);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--g6) 40%, var(--line-2));
  border-radius: 999px;
  padding: 0.16rem 0.55rem;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.debt-amount:hover { color: var(--bg); background: var(--g6); border-color: var(--g6); }
.debts-hint { font-size: var(--fs-1); color: var(--ink-faint); margin-top: 0.55rem; }
/* deuda que no se sabe a quién devolver: se cuenta, no se esconde */
.debts-orphan { font-size: var(--fs-1); color: var(--g6); margin-top: 0.4rem; }
/* le faltaba la regla: era el único texto de la tarjeta sin tamaño ni color */
.debts-clear { font-size: var(--fs-2); color: var(--g5); margin-top: 0.9rem; }

.tally {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
  background: var(--bg-soft);
}
.tally-head {
  font-size: var(--fs-2);
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
  font-size: var(--fs-2);
}
.t-name { min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.t-filling {
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.t-extra {
  font-size: var(--fs-1);
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
/*
 * scaleX en vez de width: `width` provoca reflow en cada frame, y estas barras
 * se re-animan TODAS a la vez cada vez que cambia el denominador (o sea, cada
 * vez que alguien pide). La técnica correcta ya estaba en el proyecto, en el
 * @keyframes drain del aviso.
 */
.t-fill {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--ink);
  border-radius: var(--radius-pill);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
}
/* se llena cuando el panel entra en pantalla */
.tally.is-revealed .t-fill { transform: scaleX(var(--fill, 0)); }
.t-n { color: var(--ink-dim); font-variant-numeric: tabular-nums; }
.t-money {
  color: var(--ink-faint);
  font-size: var(--fs-2);
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
  margin-bottom: var(--sp-3);
  padding-bottom: var(--sp-2);
  border-bottom: 1px solid var(--line-2);
}
.orders-head h2 {
  font-size: var(--fs-3);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.hash { color: var(--ink-faint); }
.ct { color: var(--ink-dim); font-weight: 400; }
.head-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.draw {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--ink);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.4rem 0.85rem;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, opacity 0.15s;
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
  font-size: var(--fs-2);
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--bg);
  background: var(--ink);
  border: 1px solid var(--ink);
  border-radius: var(--radius);
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  transition: color 0.18s, background 0.18s, border-color 0.18s, box-shadow 0.18s;
}
.copy:hover { box-shadow: 0 0 22px -4px var(--glow-hard); }
.copy.done {
  color: var(--g5);
  background: transparent;
  border-color: var(--g5);
  box-shadow: none;
}
.clear {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.4rem 0.8rem;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.clear:hover {
  color: var(--g1);
  border-color: var(--g1);
}

/* ---- error ---- */
.error {
  font-size: var(--fs-2);
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
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--ink-faint);
  text-align: left;
  margin-bottom: 1rem;
}
.empty p { font-size: var(--fs-3); }

/* ---- footer ---- */
.foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-2);
  color: var(--ink-faint);
  letter-spacing: 0.05em;
  padding-top: var(--sp-3);
  border-top: 1px dashed var(--line);
}
.foot-line {
  display: flex;
  gap: 0.8ch;
  justify-content: center;
  flex-wrap: wrap;
}
.foot .sep { color: var(--line-2); }

/* ---- autoría ---- */
.credit {
  display: inline-flex;
  align-items: center;
  gap: 0.7ch;
  font-size: var(--fs-1);
  letter-spacing: 0.06em;
  color: var(--ink-dim);
}
.credit b {
  font-weight: 700;
  color: var(--ink);
  letter-spacing: 0.04em;
}
/* el logotipo trae su propio fondo oscuro redondeado: se respeta tal cual y
   solo se le da el radio y un borde para que se asiente en cualquier tema */
.credit-logo {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  box-shadow: 0 0 0 1px var(--line-2);
  transition: box-shadow 0.2s, transform 0.2s;
}
.credit:hover .credit-logo {
  box-shadow: 0 0 0 1px var(--g8), 0 0 14px -4px var(--g8);
  transform: translateY(-1px);
}

/* ---- aviso: bocata con bocadillo de cómic ---- */
.toast {
  position: fixed;
  right: clamp(0.8rem, 3vw, 1.6rem);
  top: clamp(0.8rem, 3vw, 1.6rem);
  z-index: var(--z-toast);
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
  filter: drop-shadow(0 6px 10px rgba(var(--shade), 0.55));
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
  box-shadow: var(--shadow-md);
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
  font-size: var(--fs-4);
  line-height: 0.95;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.bubble-detail {
  font-size: var(--fs-2);
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