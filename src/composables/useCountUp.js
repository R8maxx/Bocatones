import { onUnmounted, ref, watch } from 'vue'

/*
 * useCountUp — interpola un número hacia su valor nuevo.
 *
 * Sirve para que los totales de dinero cuenten hasta la cifra nueva en vez de
 * saltar: cuando alguien pide o paga, se ve QUÉ número se ha movido sin tener
 * que buscarlo. Trabaja en céntimos (enteros), así que no hay decimales raros
 * a medio camino.
 *
 * Con `prefers-reduced-motion` salta directo al valor final.
 */

const reduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const easeOut = (t) => 1 - (1 - t) ** 3

export function useCountUp(source, duration = 550) {
  const initial = Number(typeof source === 'function' ? source() : source.value) || 0
  const shown = ref(initial)
  let raf = null

  function animateTo(to) {
    const from = shown.value
    if (reduced() || from === to) {
      shown.value = to
      return
    }
    cancelAnimationFrame(raf)
    const t0 = performance.now()
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration)
      shown.value = Math.round(from + (to - from) * easeOut(p))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }

  watch(source, (v) => animateTo(Number(v) || 0))
  onUnmounted(() => cancelAnimationFrame(raf))

  return shown
}
