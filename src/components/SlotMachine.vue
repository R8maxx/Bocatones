<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { personEmoji } from '../composables/usePersonEmoji.js'
import { useModal } from '../composables/useModal.js'
import { useMe } from '../composables/useMe.js'

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
const reducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const { isMe } = useMe()

const cabinet = ref(null)
useModal(cabinet, () => emit('close'))

const phase = ref('ready') // 'ready' | 'spinning' | 'done'
const armed = ref(false) // palanca tirada (esperando/girando)
const translated = ref(false) // dispara el desplazamiento de los rodillos
const reels = ref([])
let finishTimer = null

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

// arranca el giro con un sorteo ya resuelto y aterriza en el ganador
function startSpin(d) {
  reels.value = buildReels(d.people, d.winner)
  if (reducedMotion) {
    translated.value = true
    phase.value = 'done'
    return
  }
  phase.value = 'spinning'
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      translated.value = true
    }),
  )
  const maxDur = Math.max(...reels.value.map((r) => r.duration))
  finishTimer = setTimeout(() => (phase.value = 'done'), maxDur + 450)
}

// tirar de la palanca → pide el sorteo; el giro arranca cuando llega `draw`
function pull() {
  if (phase.value !== 'ready' || armed.value || !canPull.value) return
  armed.value = true
  emit('pull')
  if (props.draw) startSpin(props.draw) // por si ya estuviera disponible
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
  clearTimeout(finishTimer)
})
</script>

<template>
  <div class="slot-overlay" @click.self="emit('close')">
    <div class="rig">
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

        <!-- tornillos del chasis -->
        <span class="screw tl" aria-hidden="true" />
        <span class="screw tr" aria-hidden="true" />
        <span class="screw bl" aria-hidden="true" />
        <span class="screw br" aria-hidden="true" />

        <!-- marquesina con bombillas -->
        <div class="topper">
          <span class="bulbs" aria-hidden="true">
            <i v-for="n in 8" :key="n" :style="{ '--i': n }" />
          </span>
          <h3 id="slot-title"><span aria-hidden="true">🍀</span> ¿QUIÉN RECOGE? <span aria-hidden="true">🍀</span></h3>
          <span class="bulbs" aria-hidden="true">
            <i v-for="n in 8" :key="n" :style="{ '--i': n }" />
          </span>
        </div>

        <!-- rayas arcade -->
        <div class="rails" aria-hidden="true"><span /><span /><span /></div>

        <div class="console">
          <div class="reels-frame">
            <div class="reels" :class="{ spinning: phase === 'spinning' }">
              <div class="payline" aria-hidden="true" />
              <div v-for="(reel, i) in reels" :key="i" class="reel">
                <div
                  class="strip"
                  :style="{
                    transform: `translateY(-${translated ? reel.offset : 0}px)`,
                    transitionDuration: reducedMotion ? '0ms' : reel.duration + 'ms',
                  }"
                >
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
                <ul v-if="oddsList.length" class="odds" aria-label="probabilidades del sorteo">
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
                        <span class="odd-pct">{{ Math.round(o.chance * 100) }}%</span>
                      </template>
                      <span class="odd-gone">{{ o.gone }}× ido</span>
                    </button>
                  </li>
                </ul>
                <p v-if="oddsList.length" class="odds-hint">
                  pulsa a quien hoy no pueda ir<template v-if="awayCount"> · {{ awayCount }} fuera</template>
                </p>
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <!-- palanca EXTERNA accionable: tírala para girar -->
      <button
        class="lever"
        type="button"
        :class="{ pulled: armed, ready: phase === 'ready' && !armed }"
        :aria-label="phase === 'ready' && !armed ? 'Tirar de la palanca para girar' : 'palanca'"
        @click="pull"
      >
        <span class="lever-mount" />
        <span class="lever-arm">
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
  transition-property: transform;
  transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); /* ease-out, decelera al parar */
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
/* al arrancar: tira hacia abajo y vuelve a subir, una sola vez */
.lever.pulled .lever-arm { animation: yank 0.85s cubic-bezier(0.3, 1.2, 0.4, 1) both; }
@keyframes yank {
  0% { transform: rotate(0deg); }
  35% { transform: rotate(72deg); } /* baja */
  100% { transform: rotate(0deg); } /* sube de nuevo */
}

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
   con reduced-motion, que aquí importa por fotosensibilidad además de por gusto */
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