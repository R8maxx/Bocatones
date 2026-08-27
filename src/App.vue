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
import NumValue from './components/NumValue.vue'
import { useOrders } from './composables/useOrders.js'
import { useDraw } from './composables/useDraw.js'
import { personEmoji } from './composables/usePersonEmoji.js'
import { fmt } from './money.js'
import { confirmSettle, confirmCollect } from './composables/useSettle.js'
import { usePayer } from './composables/usePayer.js'
import { useMe } from './composables/useMe.js'
import { usePeople } from './composables/usePeople.js'
import { useInlineEdit } from './composables/useInlineEdit.js'
import { rtStatus, isOnline } from './realtime.js'
import { confirm, useConfirm } from './composables/useConfirm.js'
import { animate, stagger, text as animeText } from 'animejs'
import { CURVE } from './animate.js'
import { DUR, prefersReduced, reducedMotion } from './motion.js'

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

// sorteo de quién recoge los bocatas (ponderado: quien menos ha ido, más papeletas)
const {
  open: slotOpen, round: slotRound, draw, winner, odds,
  openMachine, confirmDraw, closeDraw, toggleAvailable, setWinner,
} = useDraw()

/*
 * Los dos correctores en línea de la tarjeta de la cuenta. Comparten
 * useInlineEdit porque compartían también el fallo: se abrían con un booleano
 * y sólo el evento `change` los cerraba, así que abrir el desplegable por
 * curiosidad te obligaba a cambiar el pagador para poder salir.
 */
const {
  editing: editingPayer, el: payerSel, open: openPayerEdit,
  cancel: cancelPayerEdit, blur: blurPayerEdit, choose: pickPayer,
} = useInlineEdit()
const {
  editing: editingPicker, el: pickerSel, open: openPickerEdit,
  cancel: cancelPickerEdit, blur: blurPickerEdit, choose: pickPicker,
} = useInlineEdit()

const choosePayer = (e) => pickPayer(e, setPayer) // '' = volver a seguir al sorteo
const choosePicker = (e) => pickPicker(e, setWinner)

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

/*
 * Para ELEGIR a alguien a mano no vale la lista de arriba: sólo mira los
 * pedidos de hoy. Un día con deuda arrastrada pero todavía sin pedidos dejaba
 * el desplegable sin una sola opción, y un <select> vacío no se puede usar ni
 * cerrar. Los de hoy van primero, que son los candidatos probables; detrás, el
 * resto de conocidos.
 */
const { withKnown } = usePeople()
const pickable = computed(() => withKnown(people.value))

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

/* ----------------------------------------------------------------
   El nombre de quien recoge SE DESCIFRA, como el título.

   Es el dato más mirado de la portada y entraba con el `swap` genérico: la
   celebración del sorteo vivía solo dentro de la tragaperras, y el momento «ya
   se sabe quién baja al bar» no se notaba en la página.

   Va con `scrambleText` de anime.js y NO con la mecánica de GlitchTitle, que
   colorea letra a letra y sería más vistosa, por dos razones concretas:

    - .pick-name lleva `overflow: hidden; text-overflow: ellipsis`, y esa
      mecánica pinta un span por letra. La elipsis NO ellipsiza inline-blocks:
      los recorta a media caja. `scrambleText` escribe un solo nodo de texto, así
      que la elipsis sigue viva con un nombre largo.
    - ocho tonos aleatorios compitiendo con el título tres centímetros más arriba
      es ruido. Aquí el color lo pone un único --g3 que se enfría a saltos,
      calcado de .nf-hot (base.css:502): el mismo gesto que ya tiene una cifra
      cuando se mueve. El color sigue viviendo solo en el movimiento.

   Y se dispara al CERRAR la cabina, no al llegar el resultado. useDraw pone el
   ganador en cuanto llega el mensaje del WebSocket (useDraw.js:56), o sea
   MIENTRAS los rodillos siguen girando: la tarjeta está entonces detrás del velo
   de la tragaperras, así que descifrar ahí es tirar el efecto a la basura.
   Cuando se apunta a mano no hay modal y se descifra al momento.
   ---------------------------------------------------------------- */
const pickName = ref(null)
let pendingReveal = null // nombre pendiente de descifrar

function decode(el, name) {
  // con movimiento reducido, Vue ya ha pintado el nombre y así se queda
  if (reducedMotion.value) return

  animate(el, {
    textContent: animeText.scrambleText({
      // `text` NO es opcional: scramble.js cachea el textContent original en un
      // WeakMap la primera vez y no lo vuelve a leer, así que sin esto el
      // SEGUNDO sorteo se asentaría en el nombre del primero.
      text: name,
      chars: '!<>-_\\/[]{}—=+*^?#01ABCDEF$%&@', // los glifos del título
      from: 'left',
      cursor: '_', // el cursor del terminal, que ya está en el vocabulario
      settleDuration: DUR.d3,
    }),
    onBegin: () => el.classList.add('is-decoding'),
    onComplete: () => {
      el.classList.remove('is-decoding')
      el.textContent = name
    },
  })
}

/*
 * El nombre se apunta como PENDIENTE y se descifra cuando se puede, que no es lo
 * mismo que cuando se sabe. Hay dos motivos para esperar, y los dos pasan:
 *
 *  - la tragaperras está abierta: el ganador llega por WebSocket mientras los
 *    rodillos siguen girando (useDraw.js:56) y la tarjeta está detrás del velo;
 *  - el span todavía no existe: si se apunta a mano, el nombre cambia con el
 *    editor en línea abierto, y `swap` va con mode="out-in", así que el modo
 *    lectura no se monta hasta que el editor termina de salir.
 *
 * De ahí que se vigile también `pickName`: en cuanto el elemento aparece, se
 * gasta lo que hubiera pendiente. Sin esto el caso «lo digo yo» no descifraba
 * nunca, porque el ref valía null justo en el instante del watch.
 */
function flushReveal() {
  const el = pickName.value
  if (!pendingReveal || slotOpen.value || !el) return
  const name = pendingReveal
  pendingReveal = null
  decode(el, name)
}

/*
 * flush: 'post' para que animate() corra DESPUÉS del parcheo de Vue: el nombre
 * es un hijo de texto de .pick-name, y si Vue lo escribe después se lleva por
 * delante lo que estuviera descifrando.
 *
 * Y la comparación con el nombre anterior no es de adorno: el reenvío con
 * announce:true al reconectar (useDraw.js:58) trae un objeto nuevo con el MISMO
 * nombre, y eso no es un sorteo, no hay nada que celebrar.
 */
watch(
  () => winner.value?.name,
  (name, before) => {
    if (!name || name === before) return
    pendingReveal = name
    flushReveal()
  },
  { flush: 'post' },
)

// el elemento que aparece (se cierra el editor) y la cabina que se cierra son
// las dos formas de que un pendiente pase a poder descifrarse
watch([pickName, slotOpen], flushReveal, { flush: 'post' })

/* ----------------------------------------------------------------
   Vaciar el día: la cascada de salida.

   Era la acción más destructiva de la app y la más plana de ver. Y no por
   descuido: `clearAll` oculta los pedidos de golpe (useOrders.js:292), así que
   `count` pasa a 0 y el <OrderList v-if="count"> se DESMONTA — el
   <TransitionGroup> de dentro se va con él y las salidas de las filas no llegan
   a jugarse nunca. La lista desaparecía sin más.

   El sitio donde sí se puede animar es el @leave del <Transition> que envuelve
   los tres estados de la cola: ahí el elemento todavía está en el DOM, con sus
   filas dentro, y Vue espera a que se llame a done().

   Esto es anime.js por la puerta principal de la doctrina (base.css:349): una
   secuencia con varios tiempos sobre N elementos, que el CSS no sabe cerrar
   —el escalonado de CSS vive en `animation-delay`, y aquí las filas se van por
   el desmontaje del padre, no por una animación propia.

   La frontera con el CSS queda limpia sola:
     - una baja suelta   -> OrderList sigue montado -> `row-leave` de siempre;
     - vaciar el día     -> OrderList se va         -> esta cascada.
   ---------------------------------------------------------------- */
const clearing = ref(false)

// el flag y no una heurística sobre el número de filas: el @leave también salta
// al cambiar a la vista de histórico, y allí la cascada sobra (ya se encarga el
// <Transition name="view"> de fuera). Saber QUIÉN lo pidió es lo único fiable.
function clearDay() {
  if (!count.value) return
  clearing.value = true
  clearAll()
}

// lo que dura el barrido entero, sea cual sea el largo de la cola: stagger()
// reparte un RANGO, no un paso fijo, así que se lee igual con 3 pedidos que con
// 30 y no hace falta el tope de la 12ª que sí necesita el CSS (OrderList.vue:65)
const WIPE_SPREAD = 420

function wipeRows(el, done) {
  const wipe = clearing.value
  clearing.value = false

  const rows = wipe ? el.querySelectorAll?.('.row') : null

  /*
   * done() TIENE que llamarse en todos los caminos, o el elemento se queda
   * montado para siempre y `mode="out-in"` no mete nunca el siguiente.
   *
   * Y con retardo, no al vuelo: un hook @leave de dos argumentos le quita a Vue
   * la detección por transitionend (hasExplicitCallback, runtime-dom), así que
   * si se llama ya, la salida de `swap` se corta a mitad. --dur-1 es lo que dura
   * .swap-leave-active (base.css:416).
   */
  if (!rows?.length || prefersReduced()) {
    setTimeout(done, prefersReduced() ? 0 : DUR.d1)
    return
  }

  /*
   * La CAJA no debe apagarse mientras se barren las filas: .swap-leave-active la
   * funde en 120ms y el barrido dura 620, así que la cascada se jugaría entera
   * con la lista ya invisible. La clase se la come el desmontaje, no hay que
   * quitarla. La regla vive en base.css, con el vocabulario.
   */
  el.classList.add('wiping')

  animate(rows, {
    // la misma dirección que `row-leave-to` (OrderList.vue:463): se lee como la
    // salida de siempre pero escalonada, no como un efecto nuevo
    x: 40,
    opacity: 0,
    duration: DUR.d2,
    ease: CURVE.out,
    delay: stagger([0, WIPE_SPREAD]),
    onComplete: done,
  })
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
        <Transition name="pop">
          <span v-if="winner" class="sb-who">
            <span aria-hidden="true">{{ personEmoji(winner.name) }}</span>
            recoge <b>{{ winner.name }}</b>
          </span>
        </Transition>
        <Transition name="pop">
          <span v-if="dayPending" class="sb-due">
            sin pagar <MoneyValue :cents="dayPending" />
          </span>
        </Transition>
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
    <!--
      Relevo hoy ↔ histórico. Va con mode="out-in" a propósito: si las dos
      vistas conviven un instante, el <main> pega un salto de altura enorme.
    -->
    <Transition name="view" mode="out-in">
    <div v-if="view === 'today'" key="today" class="view-today">
    <div class="layout">
      <section class="col-form" aria-label="Nuevo pedido">
        <OrderForm @add="onAdd" />
      </section>

      <aside class="col-stats">
        <!--
          Quién recoge. Antes esta tarjeta sólo existía DESPUÉS de sortear, y su
          único gesto era volver a sortear. Como el pagador del día sale de aquí,
          el grupo que no usa la tragaperras —alguien dice "voy yo"— se quedaba
          sin nadie a quien deber el dinero. Ahora también se puede decir a mano.
        -->
        <div class="pick-card" :class="{ empty: !winner }">
          <span class="pick-lbl">// hoy recoge</span>

          <Transition name="swap" mode="out-in">
            <span v-if="editingPicker" key="edit" class="pick-edit">
              <select
                ref="pickerSel"
                class="pay-sel"
                aria-label="quién recoge hoy"
                :value="winner ? winner.name : ''"
                @change="choosePicker"
                @keydown.esc.stop.prevent="cancelPickerEdit()"
                @blur="blurPickerEdit()"
              >
                <option value="" disabled>— elige quién va —</option>
                <option v-for="p in pickable" :key="p" :value="p">{{ p }}</option>
              </select>
              <button class="pay-x" type="button" title="Dejarlo como estaba" @click="cancelPickerEdit()">✕</button>
            </span>

            <span v-else key="show" class="pick-body">
              <span class="pick-who">
                <span class="pick-emoji" aria-hidden="true">{{ winner ? personEmoji(winner.name) : '❔' }}</span>
                <!--
                  role="img" + aria-label, el mismo patrón que MoneyValue (:71) y
                  por el mismo motivo: mientras se descifra el textContent es
                  basura, y un segundo nodo .sr-only con el nombre de verdad se
                  colaría al copiar la tarjeta (aria-hidden no excluye del
                  portapapeles). Así el nombre se anuncia una vez y bien.
                -->
                <span
                  ref="pickName"
                  class="pick-name"
                  :role="winner ? 'img' : undefined"
                  :aria-label="winner ? winner.name : undefined"
                >{{ winner ? winner.name : 'nadie aún' }}</span>
              </span>
              <span class="pick-acts">
                <button
                  class="pick-btn"
                  type="button"
                  :disabled="!canDraw"
                  :title="canDraw ? 'Sortear quién recoge los bocatas' : 'Hacen falta al menos 2 personas distintas'"
                  @click="openMachine"
                >
                  🎰 {{ winner ? 'sortear de nuevo' : 'sortear' }}
                </button>
                <button
                  class="pick-btn"
                  type="button"
                  :disabled="!pickable.length"
                  title="Apuntar a mano quién va, sin sortear"
                  @click="openPickerEdit()"
                >
                  ✎ {{ winner ? 'cambiar' : 'lo digo yo' }}
                </button>
              </span>
            </span>
          </Transition>
        </div>

        <div class="stat-card">
          <div class="stat-num"><NumValue :value="count" :pad="2" /></div>
          <div class="stat-lbl">{{ count === 1 ? 'bocata en cola' : 'bocatas en cola' }}</div>
        </div>

        <!-- dinero: lo de hoy y la deuda que se arrastra de otros días -->
        <!--
          `collapse` y no `rise`: la tarjeta es alta y tiene vecinos debajo, así
          que lo que molestaba no era la falta de fundido, era el SALTO — el
          primer pedido del día la metía de golpe y empujaba el recuento.

          La envoltura NO es de adorno. El truco de `collapse` es
          grid-template-rows: 0fr → 1fr, y eso solo colapsa UN hijo directo: los
          demás caen en pistas implícitas `auto` y conservan su altura. La
          tarjeta tiene seis, así que se envuelve para que su hijo único sea
          ella. Es lo que ya dice base.css, al pie de la letra.

          Sin reindentar lo de dentro, igual que la envoltura de PriceList: son
          cien líneas y el diff no aporta nada.
        -->
        <Transition name="collapse">
        <div v-if="count || debts.length || payer">
        <div class="money-card">
          <h2 class="money-head">// la cuenta</h2>

          <!-- quién pone el dinero hoy: por defecto quien recoge, corregible -->
          <div class="pay-row">
            <span class="pay-lbl">hoy paga</span>
            <Transition name="swap" mode="out-in">
              <span v-if="editingPayer" key="edit" class="pay-edit">
                <select
                  ref="payerSel"
                  class="pay-sel"
                  aria-label="quién pone el dinero hoy"
                  :value="payer?.source === 'manual' ? payer.name : ''"
                  @change="choosePayer"
                  @keydown.esc.stop.prevent="cancelPayerEdit()"
                  @blur="blurPayerEdit()"
                >
                  <option value="">— quien recoja (automático) —</option>
                  <option v-for="p in pickable" :key="p" :value="p">{{ p }}</option>
                </select>
                <button class="pay-x" type="button" title="Dejarlo como estaba" @click="cancelPayerEdit()">✕</button>
              </span>

              <span v-else key="show" class="pay-show">
                <span class="pay-who">
                  <span class="pay-emoji" aria-hidden="true">{{ payer ? personEmoji(payer.name) : '❔' }}</span>
                  <span class="pay-txt">
                    <span class="pay-name">{{ payer ? payer.name : 'nadie, por ahora' }}</span>
                    <small v-if="payer?.source === 'draw'" class="pay-src">// quien recoge</small>
                    <small v-else-if="payer" class="pay-src">// fijado a mano</small>
                    <small v-else class="pay-src">// apunta arriba quién recoge</small>
                  </span>
                </span>
                <button class="pay-fix" type="button" @click="openPayerEdit()">✎ cambiar</button>
              </span>
            </Transition>
          </div>

          <div v-if="count" class="money-today">
            <span class="mt-row">
              <span class="mt-lbl">hoy</span>
              <span class="mt-val"><MoneyValue :cents="dayTotal" /></span>
            </span>
            <span class="mt-row" :class="dayPending ? 'due' : 'ok'">
              <span class="mt-lbl">{{ dayPending ? 'sin pagar' : 'todo pagado' }}</span>
              <!--
                Pagar el último pendiente es el momento que cierra el día, y
                saltaba de la cifra al ✓ sin nada. La cifra y el ✓ son dos
                estados del MISMO sitio: es exactamente para lo que existe
                `swap` (base.css:412). Con `key`, porque para Vue los dos son
                contenido del mismo span.
              -->
              <span class="mt-val">
                <Transition name="swap" mode="out-in">
                  <MoneyValue v-if="dayPending" key="due" :cents="dayPending" />
                  <span v-else key="ok">✓</span>
                </Transition>
              </span>
            </span>
            <!-- solo rueda el numerador: es el que se mueve cuando marcas un pago.
                 El denominador ya rueda dos veces en pantalla (arriba y en [N]). -->
            <span class="mt-hint"><NumValue :value="dayPaidCount" />/{{ count }} pedidos pagados</span>
          </div>

          <!-- tu posición en la cuenta: con nombre y apellidos, no un total ciego -->
          <div v-if="iOwe.length || owedToMe.length || myUnmarked.length" class="mine-money">
            <TransitionGroup name="list">
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
            </TransitionGroup>
          </div>

          <div v-if="debts.length" class="debts">
            <h3 class="debts-head">
              deuda acumulada <span class="debts-total"><MoneyValue :cents="debtTotal" /></span>
            </h3>
            <TransitionGroup name="list" tag="ul">
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
            </TransitionGroup>
            <p class="debts-hint">// pulsa el importe para saldar</p>
            <Transition name="rise">
              <p v-if="orphanTotal" class="debts-orphan">
                ⚠ <MoneyValue :cents="orphanTotal" /> de días sin pagador — apunta quién puso el dinero
              </p>
            </Transition>
          </div>

          <p v-else-if="count" class="debts-clear">✓ nadie arrastra deuda de otros días</p>
        </div>
        </div>
        </Transition>

        <!-- mismo caso y misma envoltura de hijo único que .money-card -->
        <Transition name="collapse">
        <div v-if="byFilling.length">
        <div v-reveal class="tally">
          <h2 class="tally-head">// recuento para el bar</h2>
          <!--
            byFilling se reordena por cantidad en cada alta y baja
            (useOrders.js): sin TransitionGroup las filas aparecian,
            desaparecian y se recolocaban de golpe. `list` y no `rise` porque
            aqui SI hay vecinos: quien se va sale del flujo y -move puede
            deslizar a los que quedan en vez de dar el tiron seco.
          -->
          <TransitionGroup name="list" tag="ul">
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
          </TransitionGroup>
        </div>
        </div>
        </Transition>
      </aside>
    </div>

    <section class="orders" aria-labelledby="orders-title">
      <div class="orders-head">
        <h2 id="orders-title">
          <span class="hash" aria-hidden="true">#</span> cola de pedidos
          <span class="ct">[<NumValue :value="count" />]</span>
        </h2>
        <!-- `pop` y no `rise`: son tres botones, y `pop` es lo que la casa usa
             para lo pequeño que aparece y desaparece (base.css:399) -->
        <Transition name="pop">
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
            @click="clearDay"
          >rm -rf *</button>
        </div>
        </Transition>
      </div>

      <Transition name="rise">
        <p v-if="error" class="error" role="alert">⚠ servidor no disponible — reintentando… ({{ error }})</p>
      </Transition>

      <!--
        El relevo de los tres estados de la cola. Antes los tres eran v-if
        pelados: al borrar el último pedido la sección saltaba de la lista al
        ASCII del bocata de golpe, y entre "cargando" y "vacío" tampoco había
        nada.

        `mode="out-in"` es obligatorio: si dos conviven un instante, la sección
        pega un salto de altura (la nota de base.css:412-414).

        Las `key` tampoco son opcionales: las dos ramas `.empty` son el MISMO
        elemento para Vue, así que sin ellas el paso de "cargando" a "vacío" no
        se anima.

        Y esta envoltura es la que hace posible la cascada del `rm -rf *`: el
        hook @leave recibe el <OrderList> con sus filas todavía en el DOM, justo
        antes de desmontarse (ver wipeRows en el script).
      -->
      <Transition name="swap" mode="out-in" @leave="wipeRows">
      <OrderList
        v-if="count"
        key="list"
        :orders="orders"
        :fresh-ids="freshIds"
        @remove="removeOrder"
        @update="updateOrder"
        @paid="setPaid"
      />

      <div v-else-if="loading" key="loading" class="empty">
        <p>cargando pedido del día… <span class="blink">_</span></p>
      </div>

      <div v-else key="empty" class="empty">
        <pre class="ascii" aria-hidden="true">  ___________
 /  BOCATA   \   sin pedidos todavía.
 \___________/   sé el primero en pedir ↑</pre>
        <p>El cursor parpadea. El bar espera. <span class="blink">_</span></p>
      </div>
      </Transition>
    </section>

    </div>

    <HistoryPanel v-else key="history" />
    </Transition>
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

    <!--
      Aviso de pedido entrante: un bocata que cae con su bocadillo de cómic.

      Teleportado a `body` por lo mismo que la barra compacta (ver arriba): el
      transform que .page conserva de su animación de arranque la convierte en el
      bloque contenedor de sus descendientes `fixed`, así que aquí dentro el
      `top` del aviso se medía desde .page y NO desde la ventana — el aviso se
      iba con el scroll y en cuanto bajabas un poco ya no se veía. Y de paso: el
      z-index tampoco valía, porque #app abre contexto de apilamiento con
      `z-index: var(--z-base)` (main.css) y dejaba a --z-toast compitiendo como
      un 1 contra todo lo que sí se teleporta.

      Y la clase `under`: la esquina de arriba a la derecha es justo donde sale
      la barra compacta, así que mientras esa está en pantalla el aviso se sienta
      debajo de ella en vez de pelearse por el sitio.
    -->
    <Teleport to="body">
      <Transition name="toast">
        <div
          v-if="toast"
          :key="toast.id"
          class="toast"
          :class="{ 'is-remove': toast.remove, under: compact }"
          role="status"
          aria-live="polite"
        >
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
    </Teleport>

    <!--
      Tragaperras: ¿quién recoge los bocatas?

      Los tres modales se montan aquí dentro de un Teleport y un <Transition>.
      El Teleport vivía antes en cada componente, pero una transición no puede
      animar un Teleport: hay que envolver el contenido, no la puerta. Movidos
      aquí, los tres entran y salen animados en vez de esfumarse al desmontarse.
    -->
    <Teleport to="body">
      <Transition name="modal">
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
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="modal">
        <PriceList v-if="showPrices" @close="showPrices = false" />
      </Transition>
    </Teleport>

    <!--
      Pregunta antes de actuar (saldar, cobrar…). Se monta y desmonta con la
      pregunta, como PriceList: useModal engancha el foco y el Escape al montar.
      El :key fuerza el remontaje si una pregunta reemplaza a otra.
    -->
    <Teleport to="body">
      <Transition name="modal">
        <ConfirmDialog v-if="confirmPending" :key="confirmPending.id" />
      </Transition>
    </Teleport>

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
  /* el alto no es decorativo: el aviso del bocata se aparta por debajo usando
     ese mismo token, y aquí es donde se cumple la promesa */
  min-height: var(--bar-h);
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
  border: 1px solid var(--g5);
  border-radius: var(--radius);
  padding: 1rem 1.2rem;
  background:
    radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--g5) 14%, transparent), transparent 60%),
    var(--panel);
  box-shadow: 0 0 22px -8px var(--g5);
  transition: box-shadow var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out);
}
.pick-card:hover { box-shadow: 0 0 26px -4px var(--g5); }
/* sin nadie apuntado no hay nada que celebrar: el verde se apaga y la tarjeta
   se queda en el gris del resto, para que se lea como un hueco por rellenar */
.pick-card.empty {
  border-color: var(--line-2);
  background: var(--panel);
  box-shadow: none;
}
.pick-card.empty .pick-name { color: var(--ink-dim); text-shadow: none; }

.pick-body { display: flex; flex-direction: column; gap: 0.45rem; min-width: 0; }
.pick-acts { display: flex; flex-wrap: wrap; gap: var(--sp-1); }
.pick-btn {
  flex: 1 1 auto;
  min-height: var(--tap);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-dim);
  font-family: var(--mono);
  font-size: var(--fs-1);
  letter-spacing: 0.04em;
  padding: 0.3rem 0.5rem;
  cursor: pointer;
  transition: color var(--dur-1), border-color var(--dur-1), background var(--dur-1);
}
.pick-btn:hover:not(:disabled) { color: var(--ink); border-color: var(--ink-dim); background: var(--bg-soft); }
.pick-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pick-edit { display: flex; align-items: center; gap: var(--sp-1); }
.pick-edit .pay-sel { flex: 1 1 auto; min-width: 0; }
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
  /* mientras se descifra se enciende en --g3 y se enfría a saltos: es el gesto
     de .nf-hot (base.css:502) para un dato que se mueve, no uno nuevo */
  transition:
    color var(--dur-4) steps(4, jump-none),
    text-shadow var(--dur-4) steps(4, jump-none);
}
.pick-name.is-decoding {
  color: var(--g3);
  text-shadow: 0 0 14px color-mix(in srgb, var(--g3) 50%, transparent);
  /* encender es instantáneo; enfriar es lo que se mira */
  transition-duration: var(--dur-1);
}
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
  /* era 0.85, y desde que la cifra la pinta NumberFlow ya no era verdad: fuerza
     line-height: 1 en su propio elemento, asi que el 0.85 solo mentia sobre la
     altura de la tarjeta */
  line-height: 1;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 20px var(--glow-soft);
  /* VT323 es muy alta para su em: la mascara por defecto (0.25em) le comia la
     parte de arriba de las cifras a este tamano */
  --number-flow-mask-height: 0.14em;
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
  transition: color var(--dur-1), background var(--dur-1), border-color var(--dur-1);
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
  min-height: var(--tap);
  max-width: 100%;
}

/*
 * Las dos mitades del relevo. Antes eran hijos sueltos del .pay-row y se
 * repartían con su justify-content; ahora van envueltas para que el
 * <Transition mode="out-in"> tenga un único hijo por estado.
 */
.pay-show,
.pay-edit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 0.5rem 0.8rem;
  min-width: 0;
}
.pay-edit { justify-content: flex-start; flex-wrap: nowrap; }
.pay-edit .pay-sel { flex: 1 1 auto; min-width: 0; }

/*
 * La salida del corrector. Sin ella el desplegable sólo se cerraba eligiendo a
 * alguien: como no llevaba :value, el navegador dejaba puesta la primera
 * opción, así que volver a elegirla no disparaba `change` y no había manera de
 * salir sin cambiar el pagador.
 */
.pay-x {
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
.pay-x:hover { color: var(--bg); background: var(--g6); border-color: var(--g6); }

/* ---- tu posición: a quién le debes y quién te debe ---- */
.mine-money {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.85rem;
  /* ancla para la fila que se va: al salir pasa a position:absolute (ver
     .list-leave-active) y sin esto se colocaría respecto a la ventana */
  position: relative;
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
/* el paso naranja -> verde (queda algo por pagar -> ya está todo) se funde: es
   un cambio de estado, no una alarma nueva */
.mt-lbl, .mt-val { transition: color var(--dur-3) var(--ease-out); }
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
.debts ul { list-style: none; display: flex; flex-direction: column; gap: 0.35rem; position: relative; }
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
/* relative porque .list-leave-active saca al que se va con position: absolute */
.tally ul { list-style: none; display: flex; flex-direction: column; gap: 0.55rem; position: relative; }
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
  --toast-top: clamp(0.8rem, 3vw, 1.6rem);
  position: fixed;
  right: clamp(0.8rem, 3vw, 1.6rem);
  top: var(--toast-top);
  z-index: var(--z-toast);
  display: flex;
  align-items: center;
  gap: 0.55rem;
  max-width: min(92vw, 380px);
  background: transparent; /* sin caja: el protagonista es el bocata */
  pointer-events: none;
  /* se desplaza con `top`, no con transform: el transform de .toast ya se lo
     reparten .toast-enter-from y .toast-leave-to, y se pisarían */
  transition: top 0.28s cubic-bezier(0.2, 0.9, 0.2, 1);
}

/* con la barra compacta en pantalla, el aviso se sienta debajo de ella. Misma
   curva y misma duración que la barra, así que bajan y suben a la par */
.toast.under { top: calc(var(--bar-h) + var(--toast-top)); }

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
  /* al aparecer la barra el aviso cambia de sitio, pero sin deslizarse */
  .toast { transition: none; }
}
</style>