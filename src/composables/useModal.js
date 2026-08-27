import { onBeforeUnmount, onMounted } from 'vue'

/*
 * useModal — comportamiento de diálogo: foco inicial, atrapado del Tab,
 * Escape, devolver el foco al cerrar y dejar el fondo inerte.
 *
 * Los dos modales declaraban `aria-modal="true"` sin cumplir nada de esto: el
 * Tab seguía recorriendo la página de debajo, el fondo scrolleaba, y el editor
 * de precios NO se cerraba con Escape porque su handler estaba en un div con
 * `tabindex="-1"` al que nadie llamaba nunca `.focus()`.
 *
 * Los avisos del sistema se teleportan a `body`, así que quedan fuera del
 * `inert` y el botón de deshacer sigue siendo accionable con un modal abierto.
 */

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function useModal(panelRef, onClose) {
  let opener = null

  const focusables = () => {
    const root = panelRef.value
    if (!root) return []
    // getClientRects() descarta lo que está oculto sin depender de estilos
    return [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const list = focusables()
    if (!list.length) return
    const first = list[0]
    const last = list[list.length - 1]
    const active = document.activeElement
    // el ciclo se cierra sobre sí mismo en los dos sentidos
    if (e.shiftKey && (active === first || active === panelRef.value)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  onMounted(() => {
    opener = document.activeElement
    document.addEventListener('keydown', onKey)
    document.getElementById('app')?.setAttribute('inert', '')
    document.body.style.overflow = 'hidden'
    // el foco va al panel, no al primer botón: así el lector de pantalla
    // anuncia el diálogo antes de nombrar un control
    requestAnimationFrame(() => panelRef.value?.focus?.())
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKey)
    document.getElementById('app')?.removeAttribute('inert')
    document.body.style.overflow = ''
    opener?.focus?.()
  })
}

/*
 * useVeilClose — cerrar al pulsar el velo, pero solo si el gesto EMPIEZA en el
 * velo.
 *
 * Con `@click.self` a secas no basta: el navegador sintetiza el `click` en el
 * ancestro común de donde pulsaste y donde soltaste, y en un modal ese ancestro
 * es justo el velo. Así que un arrastre que empieza DENTRO del panel y suelta
 * fuera cuenta como clic en el velo y cierra.
 *
 * No es teórico: el asa del arrastre se queda en `pointer-events: none` mientras
 * el gesto está vivo (lo hace anime.js para comerse el clic de después), así que
 * un tirón corto —de los que NO llegan al umbral y deben volver a su sitio—
 * suelta el ratón sobre el velo y cerraba el modal. En ConfirmDialog eso además
 * responde «no» a la pregunta.
 *
 * Comprobar el pointerdown es la forma general, y es el mismo patrón que la
 * tragaperras ya tenía para su palanca.
 */
export function useVeilClose(onClose) {
  let downOnVeil = false

  return {
    onVeilPointerDown(e) {
      downOnVeil = e.target === e.currentTarget
    },
    onVeilClick(e) {
      if (e.target === e.currentTarget && downOnVeil) onClose()
    },
  }
}
