<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

/*
 * GlitchTitle — recreación en vivo del gif "bocatones_hacker".
 * Las letras saltan entre glifos aleatorios y colores neón (paleta del gif)
 * y se asientan en blanco. Se vuelve a "descifrar" sola cada pocos segundos.
 */

const props = defineProps({
  text: { type: String, default: 'BOCATONES' },
})

const GLYPHS = '!<>-_\\/[]{}—=+*^?#01ABCDEF$%&@'
const COLORS = ['--g1', '--g2', '--g3', '--g4', '--g5', '--g6', '--g7', '--g8']

const chars = ref(
  props.text.split('').map((c) => ({ target: c, char: c, color: '', settled: true })),
)

let frame = 0
let raf = null
let loopTimer = null
const reduced =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function rand(n) {
  // pseudo-random sin Math.random bloqueado en algunos entornos headless
  return Math.floor((typeof crypto !== 'undefined' ? crypto.getRandomValues(new Uint32Array(1))[0] / 4294967295 : performance.now() % 1) * n)
}

function scramble() {
  if (reduced) return
  cancelAnimationFrame(raf)
  const targets = props.text.split('')
  // a cada letra le toca asentarse en un frame distinto -> efecto cascada
  const queue = targets.map((t, i) => ({
    target: t,
    start: i * 2,
    end: i * 2 + 14 + rand(12),
  }))
  frame = 0

  const tick = () => {
    let done = 0
    chars.value = queue.map((q) => {
      if (frame >= q.end) {
        done++
        return { target: q.target, char: q.target, color: '', settled: true }
      }
      if (frame < q.start) {
        return { target: q.target, char: q.target === ' ' ? ' ' : '', color: '', settled: false }
      }
      const c = q.target === ' ' ? ' ' : GLYPHS[rand(GLYPHS.length)]
      return { target: q.target, char: c, color: COLORS[rand(COLORS.length)], settled: false }
    })
    frame++
    if (done < queue.length) {
      raf = requestAnimationFrame(tick)
    }
  }
  tick()
}

onMounted(() => {
  scramble()
  if (!reduced) {
    loopTimer = setInterval(scramble, 6500)
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearInterval(loopTimer)
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