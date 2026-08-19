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
