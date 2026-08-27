<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { personEmoji } from '../composables/usePersonEmoji.js'
import { useModal } from '../composables/useModal.js'
import { useDragToDismiss } from '../composables/useDragToDismiss.js'
import { useMe } from '../composables/useMe.js'
import { animate, createTimeline, cubicBezier, utils } from 'animejs'
import { reducedMotion } from '../motion.js'
import { CURVE, LEVER_SPRING } from '../animate.js'
import PctValue from './PctValue.vue'

/*
 * SlotMachine — tragaperras para sortear quién recoge los bocatas.
 *
 * Dos modos de apertura:
 *  - Iniciador (draw === null al montar): la máquina abre "lista" mostrando a
 *    la gente local; al tirar de la palanca emite 'pull' (el padre sortea en el
 *    servidor) y, cuando llega el resultado por `draw`, gira y aterriza.
 *  - Resto (draw ya presente al montar): aparece y gira sola con el resultado.
 *
 * Estética monocroma que sigue el tema de la web (color solo en movimiento).
 */

const props = defineProps({
  draw: { type: Object, default: null }, // { people, winner, odds, drawId, mine } | null
  people: { type: Array, default: () => [] }, // gente local para los rodillos en espera
  odds: { type: Array, default: () => [] }, // [{ name, gone, chance }] papeletas de hoy
})
const emit = defineEmits(['close', 'pull', 'again', 'toggle'])

const REEL_CELL = 64 // alto de cada celda (px) — debe coincidir con el CSS

/*
 * Si la pestana no esta a la vista, las bombillas se paran.
 *
 * El comentario del CSS ya decia que pasaba esto, pero era mentira: no habia
 * ningun listener. Son 16 elementos repintando background y box-shadow en
 * bucle, y en una pestana de fondo eso es gasto de bateria a cambio de nada
 * que nadie ve.
 */
const tabHidden = ref(document.visibilityState === 'hidden')
const onVisibility = () => {
  tabHidden.value = document.visibilityState === 'hidden'
}
onMounted(() => document.addEventListener('visibilitychange', onVisibility))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibility))

const { isMe } = useMe()

const cabinet = ref(null)
useModal(cabinet, () => emit('close'))

/*
 * Tirar de la marquesina hacia abajo cierra la cabina.
 *
 * Era el único de los tres modales sin este gesto, y no es una salida nueva: va
 * al MISMO emit('close') que la ✕, el velo y Escape.
 *
 * `wrap` va en .rig y NO en .cabinet, y eso no es una preferencia: .cabinet
 * lleva `animation: drop-in ... both`, o sea con relleno, así que la animación
 * sigue «en efecto» para siempre y una animación CSS en efecto le gana al estilo
 * en línea en la cascada — el transform del arrastre no se vería. Es el choque
 * que documenta base.css:366-373. En .rig, que no tiene transform propio,
 * anime.js escribe a gusto y el CSS sigue mandando dentro de la cabina.
 *
 * Y de paso sale bien: la palanca es HERMANA de la cabina dentro de .rig, así
 * que las dos se arrastran como la sola pieza que son.
 *
 * `handle` va en .topper, que es la cabecera natural y —esto es lo importante—
 * NO contiene la palanca: `trigger` limita el gesto ahí, así que el
 * setPointerCapture de la palanca y su swallowClick siguen intactos.
 */
const { wrap, handle } = useDragToDismiss(() => emit('close'))

const phase = ref('ready') // 'ready' | 'spinning' | 'done'
const armed = ref(false) // palanca tirada (esperando/girando)
const reels = ref([])
// los elementos .strip, uno por rodillo (ver la nota del :ref en la plantilla)
const strips = ref([])
let spin = null

const winnerEmoji = computed(() => (props.draw ? personEmoji(props.draw.winner) : '🥪'))

// papeletas: las del sorteo si ya está resuelto, o las de hoy mientras se espera.
// De mayor a menor para que se lea como un ranking.
const oddsList = computed(() => {
  const list = props.draw?.odds?.length ? props.draw.odds : props.odds
  // disponibles primero; los que no pueden ir, al final
  return [...(list || [])].sort(
    (a, b) => (a.available === false) - (b.available === false) || b.chance - a.chance,
  )
})

// quién entra realmente en el bombo (los ausentes no salen en los rodillos)
const inPlay = computed(() => {
  const list = oddsList.value.filter((o) => o.available !== false).map((o) => o.name)
  return list.length ? list : props.people
})
const awayCount = computed(() => oddsList.value.filter((o) => o.available === false).length)
const canPull = computed(() => inPlay.value.length >= 2)

/* ----------------------------------------------------------------
   Tirar de la palanca de verdad.

   El brazo no se desplaza: PIVOTA sobre el buje (transform-origin: 50% 100%).
   Por eso el gesto no es un arrastre de la libreria —que moveria el elemento de
   sitio— sino unos manejadores de puntero propios que mapean el recorrido a
   grados. 120px de dedo son 72 grados, el tope de siempre.

   Y hay UN SOLO sitio que escribe el giro (el style.transform de aqui) y UN
   SOLO muelle que lo devuelve, compartido por el dedo y por el clic. Antes eran
   dos mecanismos peleados: el dedo escribia un estilo en linea y el clic
   disparaba un @keyframes `yank`, que al ser una animacion CSS pisaba el estilo
   en linea; de ahi el flag `dragging`, la clase `.pulled` y los 72 grados
   escritos a mano en el CSS Y en el JS, que habia que mantener iguales. Todo eso
   se ha ido: MAX_DEG es la unica copia.

   El muelle es lo unico "blando" que se permite en toda la app, y es a
   proposito: una palanca de tragaperras ES un objeto con muelle. El rebote
   esta mal en un contador de dinero y bien aqui. Vive en src/animate.js.

   Lo que SI cambia de tacto: el brazo ahora sigue al dedo 1:1. Antes el propio
   seguimiento iba amortiguado (un useSpring detras del dedo), un retraso de
   unos 180ms que casi no se veia. anime.js no tiene un muelle continuo que
   siga a un valor —cada llamada reinicia el tween desde cero— asi que el muelle
   se queda donde de verdad se ve: en la vuelta y en el clic.
   ---------------------------------------------------------------- */
const PULL_PX = 120 // recorrido del dedo para llegar al tope
const MAX_DEG = 72 // grados del brazo en el tope
const COMMIT = 0.8 // hay que bajarla al 80% para que cuente como tiron

const arm = ref(null)
let startY = 0

const setDeg = (deg) => {
  if (arm.value) arm.value.style.transform = `rotate(${deg}deg)`
}

const degFor = (px) => (Math.min(Math.max(px, 0), PULL_PX) / PULL_PX) * MAX_DEG

// la vuelta desde donde este. Con movimiento reducido, de golpe: el arrastre en
// si se queda (lo mueve la persona, no la maquina), lo que se quita es la
// inercia.
function springBack() {
  if (!arm.value) return
  if (reducedMotion.value) {
    setDeg(0)
    return
  }
  animate(arm.value, { rotate: 0, ease: LEVER_SPRING })
}

/*
 * El camino del CLIC (y del teclado): baja y vuelve a subir, una sola vez.
 *
 * Es lo que hacia el @keyframes `yank`, con el mismo perfil (baja en un tercio
 * del tiempo y sube con muelle) pero por el mismo canal que el dedo.
 */
function yank() {
  if (!arm.value || reducedMotion.value) return
  animate(arm.value, {
    rotate: [
      { to: MAX_DEG, duration: 300, ease: CURVE.out },
      { to: 0, ease: LEVER_SPRING },
    ],
  })
}

/*
 * Tragarse el clic que viene detras de un arrastre.
 *
 * El navegador sintetiza su `click` en el <button> de todas formas: un tiron
 * corto (por debajo del umbral) soltaba el brazo con el muelle Y ADEMAS
 * disparaba el @click del boton, o sea que sorteaba de todas formas. Justo lo
 * contrario de lo que promete el gesto.
 *
 * La marca se pone MIENTRAS se arrastra y no al soltar, porque el clic nativo
 * puede llegar antes que nuestro pointerup. Y se limpia en el pointerdown, asi
 * que cada gesto empieza de cero.
 */
let swallowClick = false

function onLeverPointerDown() {
  swallowClick = false
}

function onLeverClick() {
  if (swallowClick) {
    swallowClick = false
    return
  }
  // solo se tira del brazo si el tiron cuenta de verdad; pull() es quien sabe
  if (pull()) yank()
}

/*
 * El gesto, con captura de puntero.
 *
 * setPointerCapture es lo que hace que el gesto siga siendo nuestro aunque el
 * dedo se salga del brazo (que es estrecho: 13px), sin escuchar en `document`.
 * Y separa de verdad `pointerup` de `pointercancel`: si el navegador se queda el
 * gesto, la palanca vuelve pero NO sortea.
 */
function onArmDown(e) {
  if (!e.isPrimary) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (phase.value !== 'ready' || armed.value || !canPull.value) return
  swallowClick = false
  startY = e.clientY
  arm.value?.setPointerCapture?.(e.pointerId)
}

// el gesto es nuestro mientras tengamos capturado el puntero
function holding(e) {
  return arm.value?.hasPointerCapture?.(e.pointerId)
}

function onArmMove(e) {
  if (!holding(e)) return
  const px = e.clientY - startY
  // 3px es el minimo con el que esto deja de ser un toque y pasa a ser un
  // gesto, asi que tocar sigue siendo tocar
  if (Math.abs(px) > 3) swallowClick = true
  setDeg(degFor(px))
}

function onArmUp(e) {
  if (!holding(e)) return
  arm.value?.releasePointerCapture?.(e.pointerId)
  const committed = e.clientY - startY >= PULL_PX * COMMIT
  springBack()
  if (committed) pull()
}

// el navegador se ha quedado el gesto (un gesto del sistema, una llamada
// entrante): la palanca vuelve a su sitio y no se sortea nada
function onArmCancel(e) {
  if (!holding(e)) return
  arm.value?.releasePointerCapture?.(e.pointerId)
  springBack()
}

/*
 * Cerrar al pulsar el velo, pero solo si el gesto EMPIEZA en el velo.
 *
 * Con `@click.self` solo, arrastrar la palanca y soltar fuera de ella cerraba
 * la maquina: el navegador sintetiza el `click` en el ancestro comun de donde
 * pulsaste y donde soltaste, y ese ancestro es el propio velo, asi que
 * `.self` se cumplia. No era culpa del gesto nuevo —pasaba igual arrastrando
 * el raton por encima de la palanca— pero con una palanca que ahora se
 * arrastra de verdad se dispararia todo el rato.
 *
 * Comprobar el pointerdown es la forma general: un arrastre que sale de
 * dentro no es un clic en el velo, venga de donde venga.
 */
let downOnVeil = false

function onVeilPointerDown(e) {
  downOnVeil = e.target === e.currentTarget
}

function onVeilClick(e) {
  if (e.target === e.currentTarget && downOnVeil) emit('close')
}


// construye la tira de cada rodillo: gente repetida + ganador centrado al final
function buildReels(people, winnerName) {
  const base = people && people.length ? people : [winnerName]
  return [0, 1, 2].map((i) => {
    const repeats = 7 + i * 2 // cada rodillo viaja un poco más → parada escalonada
    const strip = []
    for (let r = 0; r < repeats; r++) strip.push(...base)
    // colocamos al ganador como penúltimo para que quede en la fila central con vecinos
    const filler = base[(base.indexOf(winnerName) + 1 + i) % base.length] || winnerName
    strip.push(winnerName, filler)
    const winIndex = strip.length - 2
    return {
      strip,
      offset: (winIndex - 1) * REEL_CELL, // sube hasta centrar al ganador en la línea de pago
      duration: 2200 + i * 750, // ms
    }
  })
}

/*
 * La curva del frenado del rodillo. No es un token de la casa a proposito: es
 * una deceleracion mucho mas larga que cualquier entrada de la interfaz, la que
 * hace que el rodillo parezca tener peso. Estaba escrita en el CSS de .strip.
 */
const REEL_EASE = cubicBezier(0.16, 1, 0.3, 1)

/*
 * Lo que se espera con el ganador ya en la linea de pago antes de encender la
 * fiesta. Era un `+ 450` suelto sumado a un setTimeout; ahora es un compas con
 * nombre dentro de la linea de tiempo.
 */
const REVEAL_HOLD = 450

// arranca el giro con un sorteo ya resuelto y aterriza en el ganador
function startSpin(d) {
  reels.value = buildReels(d.people, d.winner)

  if (reducedMotion.value) {
    // sin giro: los rodillos aparecen ya puestos en el ganador
    nextTick(() => {
      reels.value.forEach((reel, i) => utils.set(strips.value[i], { y: -reel.offset }))
      phase.value = 'done'
    })
    return
  }

  phase.value = 'spinning'

  /*
   * nextTick porque los .strip acaban de nacer con el sorteo: hasta que Vue no
   * los pinta no hay nada que animar. Esto es lo que antes eran dos
   * requestAnimationFrame anidados, que estaban ahi para forzar un reflujo y
   * que la transicion CSS arrancara de verdad; anime.js no necesita el truco,
   * solo necesita el elemento.
   */
  nextTick(() => {
    const maxDur = Math.max(...reels.value.map((r) => r.duration))

    /*
     * Una sola linea de tiempo posee la secuencia entera: los tres rodillos
     * arrancan juntos (posicion 0) y cada uno frena cuando le toca, y el
     * resultado se descubre en su compas. Antes esto eran tres transiciones CSS
     * sueltas y un setTimeout que tenia que sumar a mano la duracion mas larga.
     */
    spin = createTimeline()
    reels.value.forEach((reel, i) => {
      spin.add(strips.value[i], { y: -reel.offset, duration: reel.duration, ease: REEL_EASE }, 0)
    })
    spin.call(() => {
      phase.value = 'done'
    }, maxDur + REVEAL_HOLD)
  })
}

/*
 * Tirar de la palanca → pide el sorteo; el giro arranca cuando llega `draw`.
 *
 * Devuelve si el tiron ha contado, porque el camino del clic necesita saberlo
 * para animar el brazo (el del dedo ya lo tiene abajo).
 */
function pull() {
  if (phase.value !== 'ready' || armed.value || !canPull.value) return false
  armed.value = true
  emit('pull')
  if (props.draw) startSpin(props.draw) // por si ya estuviera disponible
  return true
}

// cuando llega el resultado tras tirar de la palanca, arranca el giro
watch(
  () => props.draw,
  (d) => {
    if (d && armed.value && phase.value === 'ready') startSpin(d)
  },
)

onMounted(() => {
  if (props.draw) {
    // resto de pantallas (o resultado ya disponible): gira directamente
    startSpin(props.draw)
  } else {
    // iniciador: muestra a quien puede ir y espera a la palanca
    reels.value = buildReels(inPlay.value, inPlay.value[0] || '?')
    phase.value = 'ready'
  }
})

// si se marca a alguien como ausente mientras la máquina espera, los rodillos
// se rehacen para que no aparezca en ellos
watch(inPlay, (list) => {
  if (phase.value === 'ready' && !armed.value) reels.value = buildReels(list, list[0] || '?')
})

onBeforeUnmount(() => {
  spin?.revert()
  spin = null
})
</script>

<template>
  <div class="slot-overlay" @pointerdown="onVeilPointerDown" @click="onVeilClick">
    <div ref="wrap" class="rig">
      <div
        ref="cabinet"
        class="cabinet"
        :class="{ won: phase === 'done' }"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slot-title"
        tabindex="-1"
      >
        <button class="x" type="button" aria-label="cerrar" @click="emit('close')">✕</button>

        <!-- la pista de que se puede tirar. Entre los dos tornillos de arriba se
             lee como una ranura del chasis, que es justo lo que queremos. -->
        <span class="modal-grabber" aria-hidden="true" />

        <!-- tornillos del chasis -->
        <span class="screw tl" aria-hidden="true" />
        <span class="screw tr" aria-hidden="true" />
        <span class="screw bl" aria-hidden="true" />
        <span class="screw br" aria-hidden="true" />

        <!-- marquesina con bombillas -->
        <!-- .modal-grab trae el cursor y, sobre todo, el `touch-action` con su
             !important: anime.js escribe `pan-x` EN LÍNEA sobre el trigger al
             armar el arrastre, y eso se llevaría por delante el pinch-zoom
             (la razón entera está en base.css:288-299) -->
        <div ref="handle" class="topper modal-grab">
          <span class="bulbs" :class="{ paused: tabHidden }" aria-hidden="true">
            <i v-for="n in 8" :key="n" :style="{ '--i': n }" />
          </span>
          <h3 id="slot-title"><span aria-hidden="true">🍀</span> ¿QUIÉN RECOGE? <span aria-hidden="true">🍀</span></h3>
          <span class="bulbs" :class="{ paused: tabHidden }" aria-hidden="true">
            <i v-for="n in 8" :key="n" :style="{ '--i': n }" />
          </span>
        </div>

        <!-- rayas arcade -->
        <div class="rails" aria-hidden="true"><span /><span /><span /></div>

        <div class="console">
          <div class="reels-frame">
            <div class="reels" :class="{ spinning: phase === 'spinning' }">
              <div class="payline" aria-hidden="true" />
              <!--
                El :ref es una funcion y no un ref="strips" a secas porque Vue
                NO garantiza que el array de un ref dentro de un v-for salga en
                el orden de la lista, y aqui el indice ES el rodillo: el 0 frena
                antes que el 1. El transform lo escribe anime.js (ver startSpin),
                asi que aqui no hay estilo en linea.
              -->
              <div v-for="(reel, i) in reels" :key="i" class="reel">
                <div class="strip" :ref="(el) => (strips[i] = el)">
                  <div v-for="(name, j) in reel.strip" :key="j" class="cell">
                    <span class="cell-emoji">{{ personEmoji(name) }}</span>
                    <span class="cell-name">{{ name }}</span>
                  </div>
                </div>
              </div>
              <!-- reflejo del cristal + escáner CRT sobre los rodillos -->
              <div class="glass" aria-hidden="true" />
            </div>
          </div>

          <!-- bandeja de premios -->
          <div class="tray">
            <Transition name="winner" mode="out-in">
              <div v-if="phase === 'done'" key="done" class="result" aria-live="polite">
                <div class="result-emoji">{{ winnerEmoji }}</div>
                <div class="result-text">
                  <p class="result-lbl">// hoy recoge</p>
                  <p class="result-name">{{ draw.winner }}</p>
                </div>
                <div class="result-actions">
                  <button class="again" type="button" @click="emit('again')">🎰 otra vez</button>
                  <button class="ok" type="button" @click="emit('close')">de acuerdo</button>
                </div>
              </div>
              <p v-else-if="armed || phase === 'spinning'" key="spin" class="tray-hint">▘▙ girando… ▟▝</p>
              <div v-else key="ready" class="ready">
                <p v-if="canPull" class="tray-hint blink-hint">↓ tira de la palanca ↓</p>
                <p v-else class="tray-hint warn">
                  hacen falta 2 que puedan ir
                </p>
                <!-- papeletas a la vista: quien menos ha ido, más probabilidad.
                     Cada fila se puede pulsar para marcar que hoy no puede ir. -->
                <!--
                  oddsList se reordena en CADA toggle de disponibilidad: los
                  disponibles primero y luego por probabilidad. Sin esto las
                  filas saltaban a su sitio nuevo. Con -move se deslizan, y a la
                  vez los porcentajes ruedan: es el mismo gesto contado dos veces.
                -->
                <TransitionGroup
                  v-if="oddsList.length"
                  name="list"
                  tag="ul"
                  class="odds"
                  aria-label="probabilidades del sorteo"
                >
                  <li v-for="o in oddsList" :key="o.name">
                    <button
                      type="button"
                      class="odd"
                      :class="{ away: o.available === false, mine: isMe(o.name) }"
                      :aria-pressed="o.available !== false"
                      :title="o.available === false ? `${o.name} no puede ir hoy — pulsa para volver a incluirle` : `${o.name} entra en el sorteo — pulsa si hoy no puede ir`"
                      @click="emit('toggle', o.name)"
                    >
                      <span class="odd-name">{{ personEmoji(o.name) }} {{ o.name }}</span>
                      <span v-if="o.available === false" class="odd-away">no puede</span>
                      <template v-else>
                        <span class="odd-bar" aria-hidden="true">
                          <span class="odd-fill" :style="{ '--fill': o.chance }" />
                        </span>
                        <span class="odd-pct"><PctValue :chance="o.chance" /></span>
                      </template>
                      <span class="odd-gone">{{ o.gone }}× ido</span>
                    </button>
                  </li>
                </TransitionGroup>
                <p v-if="oddsList.length" class="odds-hint">
                  pulsa a quien hoy no pueda ir<template v-if="awayCount"> · {{ awayCount }} fuera</template>
                </p>
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <!-- palanca EXTERNA accionable: tírala para girar -->
      <!--
        Sigue siendo un <button> con @click: Enter, Espacio y el toque seco
        funcionan igual que antes. Por encima de 3px el gesto se come el clic
        (swallowClick), asi que tocar es tocar y arrastrar es arrastrar en el
        mismo sitio.

        El giro del brazo lo escribe el JS y solo el JS: ya no hay una clase
        .pulled con un @keyframes peleandose con el estilo en linea.
      -->
      <button
        class="lever"
        type="button"
        :class="{ ready: phase === 'ready' && !armed }"
        :aria-label="phase === 'ready' && !armed ? 'Tirar de la palanca para girar' : 'palanca'"
        @pointerdown="onLeverPointerDown"
        @click="onLeverClick"
      >
        <span class="lever-mount" />
        <span
          ref="arm"
          class="lever-arm"
          @pointerdown="onArmDown"
          @pointermove="onArmMove"
          @pointerup="onArmUp"
          @pointercancel="onArmCancel"
        >
          <span class="lever-rod" />
          <span class="lever-ball" />
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.slot-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  padding: 1rem;
  background: radial-gradient(120% 120% at 50% 0%, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0.92));
  backdrop-filter: blur(4px);
}

/* paleta derivada del TEMA (color solo en movimiento: luces + victoria)
 *
 * Cada variable se declara DOS VECES a propósito. Una custom property con un
 * valor que no parsea no cae al valor anterior de la cascada: se resuelve a
 * `unset` allí donde se use, y en cadena. Sin este fallback, un navegador sin
 * color-mix (iOS 15, WebView viejo) no degradaba la tragaperras: la hacía
 * desaparecer, porque se iban de golpe los fondos de la cabina, la consola,
 * los rodillos, la bandeja y la palanca.
 *
 * Los valores planos usan `--sink`, que useTheme.js orienta hacia el negro en
 * los temas oscuros y hacia el blanco en los claros.
 */
.rig {
  --metal-hi: var(--panel);
  --metal-hi: color-mix(in srgb, var(--ink) 13%, var(--panel));
  --metal: var(--panel);
  --metal-lo: var(--bg);
  --deep: var(--bg);
  --deep: color-mix(in srgb, var(--bg), var(--sink) 45%);
  --window: var(--bg);
  --window: color-mix(in srgb, var(--bg), var(--sink) 30%);
  --reelbox: var(--bg);
  --reelbox: color-mix(in srgb, var(--bg), var(--sink) 58%);
  --edge: var(--line-2);
  --chrome-hi: var(--ink);
  --chrome-hi: color-mix(in srgb, var(--ink) 85%, var(--panel));
  --chrome-mid: var(--ink-dim);
  --chrome-mid: color-mix(in srgb, var(--ink) 45%, var(--panel));

  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

/* ---- cabina: metal con textura cepillada, en tonos del tema ---- */
.cabinet:focus { outline: none; }
.cabinet {
  position: relative;
  width: min(92vw, 560px);
  padding: 18px;
  border-radius: 16px;
  border: 1px solid var(--edge);
  background:
    repeating-linear-gradient(45deg, color-mix(in srgb, var(--ink) 4%, transparent) 0 2px, transparent 2px 7px),
    linear-gradient(160deg, var(--metal-hi) 0%, var(--metal) 48%, var(--metal-lo) 100%);
  box-shadow:
    0 40px 90px -20px #000,
    0 0 0 1px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 color-mix(in srgb, var(--ink) 22%, transparent),
    inset 0 -4px 10px rgba(0, 0, 0, 0.5);
  animation: drop-in 0.45s cubic-bezier(0.2, 1.3, 0.4, 1) both;
}
@keyframes drop-in {
  from { transform: translateY(-26px) scale(0.95); opacity: 0; }
}

/* botón cerrar: SIEMPRE por encima de luces y marco */
.x {
  position: absolute;
  top: -12px;
  right: -12px;
  z-index: 20;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  background: radial-gradient(circle at 35% 30%, var(--metal-hi), var(--metal-lo));
  border: 1px solid var(--edge);
  border-radius: 50%;
  width: 2.1rem;
  height: 2.1rem;
  cursor: pointer;
  box-shadow: var(--shadow-sm), inset 0 1px 1px var(--glow-soft);
  transition: color 0.15s, border-color 0.15s, transform 0.15s;
}
.x:hover { color: var(--ink); border-color: var(--ink-dim); transform: rotate(90deg); }

/* tornillos en las esquinas */
.screw {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--ink) 38%, var(--panel)), var(--panel) 65%, var(--bg));
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.6);
  z-index: 6;
}
.screw::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-top: 1.5px solid rgba(0, 0, 0, 0.6); /* ranura del tornillo */
  transform: rotate(35deg);
}
.screw.tl { top: 7px; left: 7px; }
.screw.tr { top: 7px; right: 7px; }
.screw.bl { bottom: 7px; left: 7px; }
.screw.br { bottom: 7px; right: 7px; }

/* ---- marquesina ---- */
.topper {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0 0.4rem;
  margin-bottom: 10px;
}
.topper h3 {
  font-family: var(--crt);
  font-size: var(--fs-5);
  letter-spacing: 0.05em;
  white-space: nowrap;
  color: var(--ink);
  text-shadow: 0 0 16px color-mix(in srgb, var(--ink) 35%, transparent);
}
.bulbs {
  flex: 1;
  display: flex;
  gap: 0.6ch;
  justify-content: center;
}
/* bombilla: apagada = tenue del tema; encendida = brillo de tinta. Barrido limpio. */
.bulbs i {
  will-change: background, box-shadow;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ink) 9%, var(--panel));
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5);
  animation: chase 1.2s steps(1, end) infinite;
  animation-delay: calc(var(--i) * 0.14s);
}
@keyframes chase {
  0%, 50%, 100% {
    background: color-mix(in srgb, var(--ink) 9%, var(--panel));
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5);
  }
  /* solo encendida una fracción del ciclo → la luz "viaja" */
  16% {
    background: var(--ink);
    box-shadow: 0 0 10px 1px color-mix(in srgb, var(--ink) 80%, transparent);
  }
}
/* al ganar: parpadeo multicolor (color SOLO en movimiento, como la web) */
.cabinet.won .bulbs i {
  will-change: background, box-shadow;
  animation: party 0.45s steps(1, end) infinite;
  animation-delay: calc(var(--i) * 0.05s);
}
@keyframes party {
  0% { background: var(--g1); box-shadow: 0 0 11px var(--g1); }
  25% { background: var(--g3); box-shadow: 0 0 11px var(--g3); }
  50% { background: var(--g5); box-shadow: 0 0 11px var(--g5); }
  75% { background: var(--g7); box-shadow: 0 0 11px var(--g7); }
  100% { background: var(--g1); box-shadow: 0 0 11px var(--g1); }
}

/* ---- rayas arcade ---- */
.rails {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 12px;
}
.rails span {
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--line-2) 12%, var(--ink-faint) 50%, var(--line-2) 88%, transparent);
}
.rails span:nth-child(2) { opacity: 0.7; }
.rails span:nth-child(3) { opacity: 0.4; }

/* ---- consola interior ---- */
.console {
  border-radius: 12px;
  padding: 0.9rem;
  background: linear-gradient(180deg, var(--metal) 0%, var(--metal-lo) 55%, var(--deep) 100%);
  border: 1px solid rgba(0, 0, 0, 0.6);
  box-shadow:
    inset 0 2px 3px color-mix(in srgb, var(--ink) 6%, transparent),
    inset 0 -22px 44px rgba(0, 0, 0, 0.6),
    0 2px 0 color-mix(in srgb, var(--ink) 6%, transparent);
}

/* marco que rodea los rodillos */
.reels-frame {
  padding: 7px;
  border-radius: 10px;
  background: linear-gradient(160deg, var(--line-2), var(--line));
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), 0 2px 4px rgba(0, 0, 0, 0.5);
}

.reels {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  padding: 5px;
  border-radius: 7px;
  background: var(--reelbox);
  box-shadow: inset 0 0 26px rgba(0, 0, 0, 0.9);
}

.reel {
  position: relative;
  height: calc(64px * 3); /* 3 celdas visibles */
  overflow: hidden;
  border-radius: 4px;
  background: linear-gradient(180deg, var(--window) 0%, var(--reelbox) 50%, var(--window) 100%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 5%, transparent);
  /* curvatura del cilindro: oscurece arriba y abajo */
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 22%, #000 78%, transparent);
          mask-image: linear-gradient(180deg, transparent, #000 22%, #000 78%, transparent);
}
.strip {
  display: flex;
  flex-direction: column;
  /* el desplazamiento y su curva los pone anime.js (ver REEL_EASE en el script):
     un rodillo que frena no es una transicion de interfaz, es una secuencia con
     tres tiempos distintos que tiene que acabar cuando le toca */
}
.cell {
  height: 64px;
  flex: 0 0 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.12rem;
}
.cell-emoji { font-size: var(--fs-6); line-height: 1; filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.6)); }
.cell-name {
  font-size: var(--fs-1);
  font-weight: 600;
  letter-spacing: 0.02em;
  /* la tinta del tema al 72% en vez de --ink-dim: los rodillos son una
     superficie hundida, no --panel, así que el color atenuado del tema se
     quedaba corto de contraste (1.1:1 en el tema claro, 3.1:1 tras el arreglo
     de la paleta). Con la tinta atenuada por opacidad sube en los dos temas. */
  color: var(--ink);
  opacity: 0.72;
  max-width: 100%;
  padding: 0 0.2rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* reflejo de cristal + escáner CRT (eco de la estética de la web) */
.glass {
  position: absolute;
  inset: 5px;
  border-radius: 5px;
  pointer-events: none;
  z-index: 3;
  background:
    repeating-linear-gradient(0deg, color-mix(in srgb, var(--ink) 5%, transparent) 0 1px, transparent 1px 3px),
    linear-gradient(105deg, color-mix(in srgb, var(--ink) 13%, transparent) 0%, color-mix(in srgb, var(--ink) 3%, transparent) 22%, transparent 40%);
}

/* línea de pago: franja central iluminada donde aterriza el ganador */
.payline {
  position: absolute;
  left: 3px;
  right: 3px;
  top: 50%;
  height: 64px;
  transform: translateY(-50%);
  pointer-events: none;
  z-index: 2; /* debajo del cristal, encima de la tira */
  border-top: 2px solid color-mix(in srgb, var(--ink) 42%, transparent);
  border-bottom: 2px solid color-mix(in srgb, var(--ink) 42%, transparent);
  /* foco que ilumina la fila seleccionada para que se lea bien */
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--ink) 11%, transparent) 50%, transparent);
}
.cabinet.won .payline {
  border-color: var(--g5);
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--g5) 30%, transparent) 50%, transparent);
  box-shadow: 0 0 22px -2px var(--g5), inset 0 0 20px -4px var(--g5);
}
/* al ganar, el nombre de la fila central resalta */
.cabinet.won .cell-name { opacity: 1; text-shadow: 0 0 8px var(--glow-hard); }

/* ---- palanca externa (botón accionable) ---- */
.lever {
  position: relative;
  width: 50px;
  height: 230px;
  flex: 0 0 50px;
  align-self: center;
  padding: 0;
  background: none;
  border: none;
  cursor: default;
}
.lever.ready { cursor: pointer; }
/* sin esto, arrastrar la palanca en tactil scrollearia la pagina en vez de
   mover el brazo. Se puede poner sin miedo: el unico scroller interno de la
   maquina es .odds, que NO es ancestro de la palanca, y useModal deja el body
   en overflow:hidden mientras el modal esta abierto. */
.lever { touch-action: none; }
.lever.ready .lever-arm { cursor: grab; }
.lever.ready .lever-arm:active { cursor: grabbing; }
/* caja/buje donde gira la palanca, anclada a la cabina */
.lever-mount {
  position: absolute;
  bottom: 44px;
  left: 0;
  width: 30px;
  height: 36px;
  border-radius: 7px 3px 3px 7px;
  background: linear-gradient(90deg, var(--metal-lo), var(--metal-hi) 60%, color-mix(in srgb, var(--ink) 25%, var(--panel)));
  border: 1px solid var(--edge);
  box-shadow: inset 0 1px 1px color-mix(in srgb, var(--ink) 20%, transparent), 0 3px 6px rgba(0, 0, 0, 0.6);
}
.lever-mount::after {
  content: '';
  position: absolute;
  top: 50%;
  right: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translateY(-50%);
  background: radial-gradient(circle at 35% 30%, var(--chrome-mid), var(--metal-lo)); /* eje/tornillo */
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5);
}
/* brazo que pivota desde el buje */
.lever-arm {
  position: absolute;
  bottom: 54px; /* altura del eje de giro */
  left: 18px;
  width: 13px;
  height: 138px;
  transform-origin: 50% 100%;
  transform: rotate(0deg);
}
.lever-rod {
  position: absolute;
  inset: 0;
  border-radius: 8px;
  background: linear-gradient(90deg, var(--chrome-hi) 0%, var(--chrome-mid) 45%, var(--metal-lo) 100%);
  box-shadow: inset -1px 0 1px rgba(0, 0, 0, 0.55), inset 2px 0 2px color-mix(in srgb, var(--ink) 40%, transparent);
}
.lever-ball {
  position: absolute;
  top: -20px;
  left: 50%;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  transform: translateX(-50%);
  background: radial-gradient(circle at 33% 28%, var(--chrome-hi), var(--chrome-mid) 42%, var(--metal-lo) 100%);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.6), inset 0 -3px 6px rgba(0, 0, 0, 0.4);
}
/* en estado "lista", la bola invita con un bote suave */
.lever.ready .lever-ball { animation: bob 1.4s ease-in-out infinite; }
@keyframes bob {
  0%, 100% { transform: translateX(-50%) translateY(0); }
  50% { transform: translateX(-50%) translateY(-5px); }
}
/* el tiron (con el dedo o con el raton) lo anima anime.js sobre este mismo
   elemento: un solo muelle para los dos caminos, y los grados del tope viven
   solo en MAX_DEG. Aqui queda el estado de reposo, que es el de arriba. */

/* ---- bandeja de premios ---- */
.tray {
  margin-top: 0.9rem;
  min-height: 2.5rem;
  border-radius: 8px;
  padding: 0.7rem 1rem;
  background: linear-gradient(180deg, var(--deep), color-mix(in srgb, var(--bg), #000 30%));
  box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.85), inset 0 -1px 0 color-mix(in srgb, var(--ink) 5%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
}
/* ---- papeletas visibles antes de tirar ---- */
.ready { display: flex; flex-direction: column; gap: 0.55rem; width: 100%; }
.odds {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  width: 100%;
  max-height: 8.5rem;
  overflow-y: auto;
  padding: 0.5rem 0.6rem;
  border: 1px dashed var(--line-2);
  border-radius: var(--radius);
}
/* relative porque .list-leave-active saca al que se va con position: absolute */
.odds { position: relative; }
.odds li { display: block; }
.odd {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 52px 2.4rem 3.6rem;
  align-items: center;
  gap: 0.45rem;
  font-size: var(--fs-1);
  color: var(--ink-dim);
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  min-height: var(--tap);
  padding: 0.14rem 0.4rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}
.odd:hover { border-color: var(--line-2); background: var(--bg-soft); }
.odd.mine .odd-name { font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }

/* quien hoy no puede ir: tachado, sin barra y sin porcentaje */
.odd.away { opacity: 0.5; }
.odd.away .odd-name { text-decoration: line-through; color: var(--ink-dim); }
.odd-away {
  grid-column: 2 / 4;
  text-align: center;
  font-size: var(--fs-1);
  letter-spacing: 0.04em;
  color: var(--g6);
  white-space: nowrap;
}
.odds-hint {
  font-size: var(--fs-1);
  color: var(--ink-faint);
  letter-spacing: 0.04em;
}
.tray-hint.warn { color: var(--g6); }
.odd-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
}
.odd-bar { height: 5px; background: var(--line); border-radius: 999px; overflow: hidden; }
.odd-fill {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--ink);
  border-radius: var(--radius-pill);
  transform: scaleX(var(--fill, 0));
  transform-origin: left;
  transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.odd-pct { text-align: right; font-variant-numeric: tabular-nums; color: var(--ink); }
.odd-gone { text-align: right; font-size: var(--fs-1); color: var(--ink-faint); white-space: nowrap; }

/* 16 bombillas repintando en bucle: se paran si la pestaña no está visible y
   con reduced-motion, que aquí importa por fotosensibilidad además de por gusto.
   Lo de la pestaña lo pone .paused, que lo enciende el visibilitychange del
   script: antes esta línea lo prometía y no lo cumplía nadie. */
.bulbs.paused i { animation-play-state: paused; }

@media (prefers-reduced-motion: reduce) {
  .bulbs i { animation: none !important; background: var(--metal-hi) !important; box-shadow: none !important; }
}

@media (max-width: 520px) {
  .odd { grid-template-columns: minmax(0, 1fr) 2.4rem; }
  .odd-bar, .odd-gone { display: none; }
  .odd-away { grid-column: 2; }
}

.tray-hint {
  font-family: var(--crt);
  font-size: var(--fs-4);
  letter-spacing: 0.08em;
  color: var(--ink);
  text-shadow: 0 0 10px color-mix(in srgb, var(--ink) 40%, transparent);
}
.blink-hint { animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.35; } }

.result {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  width: 100%;
  flex-wrap: wrap;
  justify-content: center;
}
.result-emoji {
  font-size: 2.8rem;
  line-height: 1;
  filter: drop-shadow(0 0 12px color-mix(in srgb, var(--g5) 70%, transparent));
  animation: pop-emoji 0.5s cubic-bezier(0.2, 1.5, 0.4, 1) both;
}
@keyframes pop-emoji { from { transform: scale(0.3) rotate(-20deg); opacity: 0; } }
.result-text { text-align: left; min-width: 0; }
.result-lbl {
  font-size: var(--fs-2);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.result-name {
  font-family: var(--crt);
  font-size: var(--fs-6);
  line-height: 1;
  color: var(--ink);
  text-shadow: 0 0 16px color-mix(in srgb, var(--g5) 60%, transparent);
}
.result-actions {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}
.again, .ok {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 700;
  letter-spacing: 0.03em;
  border-radius: var(--radius);
  padding: 0.45rem 0.95rem;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.again {
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
}
.again:hover { color: var(--ink); border-color: var(--ink-dim); }
.ok {
  color: var(--bg);
  background: var(--ink);
  border: 1px solid var(--ink);
}
.ok:hover { box-shadow: 0 0 22px -4px color-mix(in srgb, var(--ink) 50%, transparent); }

.winner-enter-active, .winner-leave-active { transition: opacity 0.35s ease, transform 0.35s ease; }
.winner-enter-from { opacity: 0; transform: translateY(8px); }
.winner-leave-to { opacity: 0; }

@media (max-width: 520px) {
  .lever { width: 34px; flex-basis: 34px; height: 200px; }
  .lever-ball { width: 28px; height: 28px; }
  .topper h3 { font-size: var(--fs-4); }
}
</style>