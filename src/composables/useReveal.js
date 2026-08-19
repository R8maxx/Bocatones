/*
 * v-reveal — añade la clase `is-revealed` cuando el elemento entra en pantalla.
 *
 * Un solo IntersectionObserver compartido para todo el proyecto, y se deja de
 * observar en cuanto un elemento ya se ha revelado. Con `prefers-reduced-motion`
 * la clase se pone en el montaje y no se observa nada.
 */

const reduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

let observer = null

function shared() {
  if (observer) return observer
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.add('is-revealed')
        observer.unobserve(e.target)
      }
    },
    { threshold: 0.2 },
  )
  return observer
}

export const vReveal = {
  mounted(el) {
    if (reduced()) {
      el.classList.add('is-revealed')
      return
    }
    shared().observe(el)
  },
  unmounted(el) {
    observer?.unobserve(el)
  },
}
