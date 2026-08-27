<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { createTimer } from 'animejs'
import { reducedMotion } from '../motion.js'

/*
 * GlitchTitle — recreación en vivo del gif "bocatones_hacker".
 * Las letras saltan entre glifos aleatorios y colores neón (paleta del gif)
 * y se asientan en blanco. Se vuelve a "descifrar" sola cada pocos segundos.
 *
 * El bucle lo lleva un createTimer de anime.js, y no un requestAnimationFrame a
 * mano con un setInterval al lado, por tres motivos concretos:
 *
 *  - Antes se contaban FOTOGRAMAS ("asiéntate en el frame 14"), así que en un
 *    monitor de 120 Hz el glitch entero duraba la mitad que en uno de 60. Ahora
 *    se cuenta TIEMPO: el reloj se lee de self.currentTime y dura lo mismo en
 *    cualquier pantalla.
 *  - `frameRate` dosifica el baile de glifos: 30 por segundo se lee a terminal
 *    y no a ruido, y son la mitad de repintados que antes en una pantalla
 *    normal (y la cuarta parte en una de 120 Hz).
 *  - Con la pestaña oculta el motor lo para solo, y al volver no se "adelanta"
 *    (ver src/animate.js). Un setInterval seguía disparando en segundo plano
 *    para que nadie lo viera.
 */

const props = defineProps({
  text: { type: String, default: 'BOCATONES' },
})

const GLYPHS = '!<>-_\\/[]{}—=+*^?#01ABCDEF$%&@'
const COLORS = ['--g1', '--g2', '--g3', '--g4', '--g5', '--g6', '--g7', '--g8']

/* ----------------------------------------------------------------
   Los tiempos, en milisegundos. Salen de los fotogramas que había escritos
   antes, a 60 Hz, que es donde se ajustaron a ojo: el escalón de la cascada
   eran 2 frames (33ms) y cada letra bailaba entre 14 y 26 (233 a 433ms).
   ---------------------------------------------------------------- */
const STEP = 33 // lo que tarda en arrancar la letra siguiente
const CHURN = 233 // lo que baila una letra, como mínimo
const CHURN_RAND = 200 // ...más lo que le toque, para que no acaben a la vez
const CHURN_FPS = 30 // repintados por segundo del baile de glifos
const CYCLE = 6500 // cada cuánto se vuelve a descifrar solo

const chars = ref(
  props.text.split('').map((c) => ({ target: c, char: c, color: '', settled: true })),
)

let queue = []
let timer = null
// true = el ciclo ya está en su parte quieta, no hay nada que repintar
let quiet = true

function rand(n) {
  // pseudo-random sin Math.random bloqueado en algunos entornos headless
  return Math.floor((typeof crypto !== 'undefined' ? crypto.getRandomValues(new Uint32Array(1))[0] / 4294967295 : performance.now() % 1) * n)
}

// a cada letra le toca asentarse en un momento distinto -> efecto cascada
function build() {
  queue = props.text.split('').map((target, i) => {
    const start = i * STEP
    return { target, start, end: start + CHURN + rand(CHURN_RAND) }
  })
}

// el techo del baile: cuando el reloj pasa de aquí, ya está todo asentado
const scrambleMs = () => (props.text.length - 1) * STEP + CHURN + CHURN_RAND

function settle() {
  chars.value = props.text.split('').map((c) => ({ target: c, char: c, color: '', settled: true }))
  quiet = true
}

function paint(t) {
  chars.value = queue.map((q) => {
    if (t >= q.end) return { target: q.target, char: q.target, color: '', settled: true }
    if (t < q.start) {
      return { target: q.target, char: q.target === ' ' ? ' ' : '', color: '', settled: false }
    }
    const c = q.target === ' ' ? ' ' : GLYPHS[rand(GLYPHS.length)]
    return { target: q.target, char: c, color: COLORS[rand(COLORS.length)], settled: false }
  })
  quiet = false
}

// volver a descifrar AHORA (al montar, y al pasar el ratón por encima)
function scramble() {
  if (reducedMotion.value || !timer) return
  build()
  timer.restart()
}

onMounted(() => {
  build()
  /*
   * Un solo reloj para todo: el ciclo entero es la duración, y el baile ocupa
   * solo su principio. Así el ritmo de 6,5s es exacto —lo era con el
   * setInterval y no lo sería con un loopDelay sumado a una duración variable—
   * y no hay dos temporizadores que puedan desincronizarse.
   */
  timer = createTimer({
    duration: CYCLE,
    loop: true,
    frameRate: CHURN_FPS,
    autoplay: !reducedMotion.value,
    onUpdate: (self) => {
      if (self.currentTime > scrambleMs()) {
        // la parte quieta del ciclo: se asienta UNA vez y no se toca más
        if (!quiet) settle()
        return
      }
      paint(self.currentTime)
    },
    onLoop: build, // cascada nueva en cada vuelta
  })
})

/*
 * El bucle se enciende y se apaga con el ajuste del sistema, no solo al montar:
 * antes esto se leía una vez y cambiarlo con la app abierta no hacía nada.
 */
watch(reducedMotion, (on) => {
  if (!timer) return
  if (on) {
    timer.pause()
    settle()
  } else {
    scramble()
  }
})

onBeforeUnmount(() => {
  timer?.revert()
  timer = null
})
</script>

<template>
  <h1 class="glitch" :aria-label="text" @mouseenter="scramble">
    <span class="bracket" aria-hidden="true">&lt;</span><span
      v-for="(c, i) in chars"
      :key="i"
      class="g-char"
      :class="{ settled: c.settled }"
      :style="c.color ? { color: `var(${c.color})` } : null"
      aria-hidden="true"
      >{{ c.char || ' ' }}</span
    ><span class="bracket" aria-hidden="true">/&gt;</span>
  </h1>
</template>

<style scoped>
.glitch {
  font-family: var(--mono);
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1;
  font-size: clamp(2.1rem, 9vw, 6.5rem);
  text-align: center;
  cursor: crosshair;
  user-select: none;
  text-shadow: 0 0 22px var(--glow-soft);
  display: flex;
  justify-content: center;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.bracket {
  color: var(--ink-faint);
  font-weight: 700;
}

.g-char {
  display: inline-block;
  transition: color 0.12s linear;
  min-width: 0.18em;
  text-align: center;
}

.g-char.settled {
  color: var(--ink);
}
</style>