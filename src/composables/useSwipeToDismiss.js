import { animate, createDraggable } from 'animejs'
import { CURVE } from '../animate.js'
import { DUR } from '../motion.js'

/*
 * v-swipe — deslizar un aviso a un lado para descartarlo.
 *
 * Es una directiva y no un composable porque los avisos se pintan con un v-for
 * dentro de un <TransitionGroup>: el gesto se monta por ELEMENTO, y una
 * directiva es lo único que ve nacer y morir cada uno. Mismo patrón que el
 * v-reveal de useReveal.js, y por el mismo motivo.
 *
 * Se usa `v-swipe="() => dismiss(n.id)"`, y con un valor que no sea función
 * (null) el aviso no se puede deslizar: eso es lo que deja fuera a los avisos de
 * «deshacer», que tienen que resolverse con su botón (ver la nota larga en
 * Notices.vue — descartar un `undo` deja el pedido oculto en local y vivo en el
 * servidor).
 *
 * La dirección se acepta en los dos sentidos aunque la entrada y la salida
 * viajen a la izquierda: a un pulgar no se le pide puntería.
 */

/*
 * Recorrido que cuenta como descartar.
 *
 * Se mide en recorrido de DEDO (`d.coords[0]`), no en píxeles de aviso (`d.x`):
 * el aviso avanza el 70% de lo que corre el dedo (ver containerFriction), así
 * que medir lo que se ve haría el gesto un 40% más largo de lo que era.
 */
const SWIPE_PX = 90

/*
 * ...o un manotazo rápido, aunque sea corto.
 *
 * OJO CON LA UNIDAD: el `velocity` de anime.js son PÍXELES POR MILISEGUNDO, no
 * px/s como el info.velocity.x de motion-v. Los 400 px/s de antes son estos 0,4.
 * Es un módulo sin signo, que aquí da igual: se descarta hacia los dos lados y
 * el código de antes también comparaba el valor absoluto.
 */
const FLICK_V = 0.4

// lo que recorre al salir volando. No hace falta que llegue al borde de la
// pantalla: a la mitad del camino ya se ha apagado del todo.
const FLY_PX = 420

// el elemento -> su draggable y la caja con el descarte de turno. WeakMap para
// no retener nada cuando el aviso desaparece.
const armed = new WeakMap()

function onRelease(d, el, box) {
  const far = Math.abs(d.coords[0]) > SWIPE_PX
  const fast = d.velocity > FLICK_V
  if (!far && !fast) return // la vuelta a su sitio la hace el propio gesto

  /*
   * Se corta la vuelta al centro que anime.js ya ha arrancado al soltar, pero NO
   * se hace revert() aquí: MEDIDO, un revert justo antes de animar deja el vuelo
   * sin un solo fotograma (la animación nueva nace sobre un objetivo que la
   * librería acaba de retirar, y no escribe nada). El revert llega solo, en el
   * unmounted de la directiva, cuando el aviso ya se ha ido.
   *
   * Y el vuelo se declara DE-A (`[from, to]`): la primera cifra es donde lo dejó
   * el dedo, así que no hay ni un fotograma de vuelta al centro.
   */
  const from = d.x
  d.stop()

  /*
   * Y se va por donde lo has echado. El transform en línea le gana al de
   * .notice-leave-to, así que esto es lo que se ve; la duración es la misma
   * --dur-3 que la transición de salida, para que el vuelo y el apagado
   * terminen juntos en vez de cortarse el uno al otro.
   */
  animate(el, {
    x: [from, Math.sign(from || -1) * FLY_PX],
    opacity: [1, 0],
    duration: DUR.d3,
    ease: CURVE.out,
  })

  box.dismiss()
}

function arm(el, dismiss) {
  const box = { dismiss }
  const d = createDraggable(el, {
    y: false, // solo a los lados
    /*
     * Su sitio es el límite: se sale de él con resistencia y vuelve al soltar.
     * (1 - 0.3) es el dragElastic: 0.7 que tenía antes, misma fórmula.
     *
     * Aquí SÍ se le deja la inercia de soltada (al contrario que en los modales,
     * que llevaban dragMomentum: false): un aviso nunca la tuvo desactivada, y
     * el sobrepaso al volver es parte de cómo se siente.
     */
    container: [0, 0, 0, 0],
    containerFriction: 0.3,
    releaseEase: CURVE.out, // vuelve seco, sin muelle
    // el cursor lo pone el CSS de .notice, como en el asa de los modales
    cursor: false,
    onRelease: (d) => onRelease(d, el, box),
  })
  armed.set(el, { d, box })
}

function disarm(el) {
  armed.get(el)?.d.revert()
  armed.delete(el)
}

export const vSwipe = {
  mounted(el, binding) {
    if (typeof binding.value === 'function') arm(el, binding.value)
  },
  /*
   * El descarte se guarda en una caja mutable: la plantilla pasa una arrow nueva
   * en cada pintado, y eso no es motivo para rehacer el gesto — y menos a mitad
   * de un arrastre.
   */
  updated(el, binding) {
    const entry = armed.get(el)
    if (typeof binding.value === 'function') {
      if (entry) entry.box.dismiss = binding.value
      else arm(el, binding.value)
    } else if (entry) {
      disarm(el)
    }
  },
  /*
   * Vue llama a esto cuando EMPIEZA la salida del TransitionGroup, no cuando
   * acaba. Da igual en el camino del deslizamiento (onRelease ya se ha retirado
   * de la lista), y es lo correcto en el camino normal (la ✕ o el temporizador):
   * ahí no hay transform en línea que conservar.
   */
  unmounted: disarm,
}
