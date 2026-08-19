import { ref } from 'vue'

/*
 * useConfirm — el diálogo de confirmación de la casa.
 *
 * Sustituye a los `window.confirm` / `window.prompt` que quedaban: un diálogo
 * nativo rompe la estética CRT, no respeta el tema y no se puede leer con el
 * mismo lenguaje que el resto de los avisos.
 *
 * La barrera SIGUE existiendo donde hacía falta (saldar una cuenta no tiene
 * deshacer barato: habría que volver a marcar cada pedido de cada día), pero
 * ahora la pinta la app.
 *
 * Es un canal aparte de useNotices.js: aquí se PREGUNTA antes de actuar, allí
 * se CUENTA lo que ya ha pasado.
 */

// diálogo en pantalla, o null. Solo puede haber uno: es una pregunta bloqueante.
const pending = ref(null)
let seq = 0

function answer(value) {
  const p = pending.value
  pending.value = null
  p?.resolve(value)
}

/*
 * Devuelve una promesa que se resuelve a true (confirmado) o false (cancelado,
 * Escape o clic fuera). Nunca se rechaza: quien pregunta hace `if (await ...)`.
 *
 *   title        cabecera corta, en minúsculas como el resto de los títulos
 *   text         la pregunta
 *   detail       matiz secundario (el importe, cuántos días…)
 *   code         bloque monoespaciado seleccionable (para "copia esto a mano")
 *   confirmLabel / cancelLabel
 *   danger       el botón principal en magenta: la acción destruye algo
 *   onlyOk       sin cancelar: es un aviso, no una pregunta
 */
export function confirm(opts = {}) {
  return new Promise((resolve) => {
    // si ya había una pregunta en pantalla, se da por cancelada: nadie se queda
    // esperando una promesa que no va a resolverse nunca
    if (pending.value) answer(false)
    pending.value = {
      id: ++seq,
      title: 'confirmar',
      confirmLabel: 'de acuerdo',
      cancelLabel: 'cancelar',
      danger: false,
      onlyOk: false,
      ...opts,
      resolve,
    }
  })
}

export const acceptConfirm = () => answer(true)
export const cancelConfirm = () => answer(false)

export function useConfirm() {
  return { pending, acceptConfirm, cancelConfirm }
}
