import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createDraggable } from 'animejs'
import { CURVE } from '../animate.js'

/*
 * useDragToDismiss — tirar del panel de un modal HACIA ABAJO para cerrarlo.
 *
 * Tres reglas explican todo lo que hay aquí:
 *
 * 1) El arrastre NO toca el panel, escribe en una envoltura propia. El panel lo
 *    mueve la transición CSS de App.vue (base.css, .modal-enter/leave .modal-panel)
 *    y los dos son el mismo `transform`. En un solo elemento el estilo en línea
 *    gana, así que la SALIDA se quedaría sin su translateY; y peor, si arrastras
 *    durante los 280ms de ENTRADA la transición está viva y cada movimiento del
 *    dedo arrancaría una nueva de 280ms: el panel iría con retraso detrás del
 *    dedo. En dos elementos, cada uno lo mueve quien le toca y se componen.
 *
 *    Con anime.js hay una segunda razón para las dos capas: al agarrar, escribe
 *    (y revierte) `transform: none` en TODOS los ancestros del elemento que
 *    arrastra, para poder normalizar las coordenadas del puntero. Los ancestros
 *    de la envoltura no tienen transform; el del panel sí, y es el de la
 *    transición de entrada.
 *
 * 2) El gesto solo arranca desde la CABECERA, que es el `trigger` del draggable.
 *    Así el cuerpo del panel —que es overflow:auto, y en ConfirmDialog lleva
 *    dentro un bloque copiable con user-select:all— sigue siendo suyo para
 *    scrollear y seleccionar, sin negociar nada. Antes esto costaba
 *    dragListener:false + unos dragControls; ahora es un parámetro.
 *
 * 3) No toca `document.body`. El único bloqueo de scroll de la app es el
 *    body.style.overflow de useModal, que se suelta al DESMONTAR. Cancelar no
 *    desmonta nada, así que no hay nada que soltar; confirmar llama al MISMO
 *    cierre que la ✕, el velo y Escape, así que el desmontaje normal lo suelta.
 *    Aquí no hay una tercera vía, y no debe haberla: si el cierre se hiciera
 *    desde el final de una animación y esa animación se cancelara, la página se
 *    quedaría con el scroll bloqueado para siempre.
 *
 * Devuelve dos refs de elemento: `wrap` (la envoltura que se mueve) y `handle`
 * (la cabecera de la que se tira). El componente solo tiene que ponerlas.
 */

/*
 * Cuándo un tirón cuenta como cerrar.
 *
 * 110px son más de cuatro veces el objetivo táctil mínimo (--tap = 1.6rem, unos
 * 25.6px): no hay forma de llegar ahí temblando al pulsar. Y en un móvil normal
 * es como un quinto del panel, un arco de pulgar corriente.
 *
 * Se descartó un umbral en porcentaje del panel: ConfirmDialog es bajito y la
 * lista de precios es alta, así que el mismo recorrido de dedo cerraría uno y no
 * el otro. Un gesto tiene que pesar lo mismo en los dos sitios.
 *
 * SE MIDE EN RECORRIDO DE DEDO, no en píxeles de panel. No es lo mismo: el
 * panel avanza el 55% de lo que baja el dedo (ver containerFriction), así que
 * `d.y` —lo que se ve— marcaría 110 cuando el dedo ya ha hecho 200. El recorrido
 * de dedo es `d.coords[1]`, que es lo que acumula el puntero sin amortiguar, y
 * es el equivalente exacto del info.offset.y que se leía antes.
 */
const COMMIT_PX = 110

/*
 * Atajo por velocidad: un golpe seco cierra sin recorrer los 110px. El suelo de
 * recorrido (FLICK_PX) es contra el toque con temblor, que puede dar mucha
 * velocidad y cero distancia y colarse por el filtro de velocidad a secas.
 *
 * OJO CON LA UNIDAD: el `velocity` de anime.js son PÍXELES POR MILISEGUNDO
 * (draggable.js, computeVelocity: el módulo del recorrido partido por el tiempo
 * transcurrido), no px/s como el info.velocity.y de motion-v. Los 550 px/s de
 * antes son estos 0,55: es el mismo gesto en la unidad nueva.
 *
 * Y es un MÓDULO, sin signo, así que hay que preguntar la dirección aparte (ver
 * `abajo`): un manotazo de vuelta HACIA ARRIBA desde 100px tiene velocidad de
 * sobra y todavía 40px de recorrido, y cerraría el modal justo cuando lo estás
 * rescatando.
 */
const FLICK_V = 0.55
const FLICK_PX = 32

/*
 * Hasta dónde se apaga la envoltura mientras se va: es la única pista de que el
 * gesto va a cerrar. Va en la ENVOLTURA y nunca en el velo ni en el panel, que
 * están dentro de la transición CSS: una opacidad en línea le ganaría a
 * .modal-leave-to y el modal se quedaría sin desvanecido de salida.
 *
 * Estos 240 sí van en píxeles de PANEL (`d.y`), como el useTransform de antes,
 * que leía la misma `y` ya amortiguada.
 */
const FADE_PX = 240
const FADE_MIN = 0.45

/*
 * El muelle de la vuelta cuando el tirón no llega.
 *
 * Aquí no hay muelle de verdad —la curva es --ease-out, como todo lo demás; el
 * rebote está reservado a la palanca de la tragaperras— pero anime.js saca la
 * DURACIÓN de estos dos números incluso cuando la curva es normal
 * (draggable.js: `settlingDuration - restDuration`). Con los de fábrica (80/20)
 * la vuelta tarda casi 1,5s, que en esta app es una eternidad. 1200/70 la deja
 * en unos 300ms, que es --dur-3, lo que tarda cualquier otra cosa en moverse.
 */
const RELEASE = { stiffness: 1200, damping: 70 }

export function useDragToDismiss(dismiss) {
  const wrap = ref(null)
  const handle = ref(null)
  let draggable = null

  /*
   * El modal puede desmontarse EN MEDIO del gesto: Escape, un cierre que llega
   * por WebSocket, o una pregunta que reemplaza a otra. El fin de gesto se
   * escucha en `document`, así que puede llegar cuando este componente ya no
   * existe. En ConfirmDialog eso sería un fallo de verdad: la pregunta pendiente
   * es un singleton de módulo, y se respondería «no» a la pregunta SIGUIENTE,
   * que nadie ha contestado. El revert() del final mata el gesto, y este flag es
   * el cinturón por si algo ya estaba en vuelo.
   */
  let alive = true

  /*
   * `touchcancel` = el navegador se ha quedado el gesto (un gesto del sistema,
   * una llamada entrante). Eso no es la decisión de nadie, así que NO se cierra.
   *
   * Antes esto se leía del propio evento de fin de arrastre. anime.js no lo
   * distingue: su handler manda `touchcancel` al mismo handleUp() que
   * `touchend`, y para cuando llama a onRelease ya no queda rastro del evento.
   * De ahí este flag, en fase de CAPTURA sobre `document` para llegar antes que
   * el listener de la librería, que está en burbuja sobre el mismo document.
   */
  let cancelled = false
  const onTouchCancel = () => {
    cancelled = true
  }

  /*
   * Lo que la cabecera NO le presta al gesto.
   *
   * Va en captura sobre la ENVOLTURA (un ancestro del asa) para llegar siempre
   * antes que el listener de anime.js, que está en burbuja sobre el asa. Cortar
   * aquí el mousedown/touchstart no le quita el `click` a nadie: son eventos
   * distintos.
   *
   * Hace falta, y no lo cubre el dragThreshold: en cuanto el gesto pasa el
   * umbral, anime.js le pone `pointer-events: none` al asa ENTERA, así que una
   * pulsación torcida de 8px sobre la ✕ perdería su clic. Y su handleDown no
   * mira ni el botón del ratón ni cuántos dedos hay: sin esto, un clic derecho
   * o un pellizco de dos dedos que empiece en la cabecera agarran el panel.
   */
  function guard(e) {
    if (e.type === 'mousedown' && e.button !== 0) return e.stopPropagation()
    if (e.touches && e.touches.length > 1) return e.stopPropagation()
    // los controles de la cabecera son suyos: la ✕ tiene que poder pulsarse
    if (e.target?.closest?.('button, a, input, select, textarea')) e.stopPropagation()
  }

  // el desvanecido se escribe A PELO y no con utils.set() a propósito: esto
  // corre en cada frame del gesto Y de la vuelta, y set() deja un registro para
  // revertir en cada llamada. Vue tampoco entra aquí: un ref reactivo pintaría
  // el componente entero 60 veces por segundo para mover una opacidad.
  function fade(d) {
    if (!wrap.value) return
    const t = Math.min(Math.max(d.y, 0), FADE_PX) / FADE_PX
    wrap.value.style.opacity = String(1 - t * (1 - FADE_MIN))
  }

  function settled() {
    // el gesto ha terminado y el panel está en su sitio: se quita la opacidad en
    // línea en vez de dejarla en 0.999, para que el CSS vuelva a mandar
    wrap.value?.style.removeProperty('opacity')
  }

  function onRelease(d) {
    if (!alive) return
    if (cancelled) {
      cancelled = false
      return
    }

    const travel = d.coords[1] // recorrido del DEDO, sin amortiguar
    const abajo = Math.sin(d.angle) > 0 // el eje Y crece hacia abajo
    const far = travel > COMMIT_PX
    const flick = d.velocity > FLICK_V && travel > FLICK_PX && abajo
    if (!far && !flick) return // la vuelta a su sitio la hace el propio gesto

    /*
     * anime.js ya ha arrancado la vuelta a y=0 antes de avisar del fin del
     * gesto (lo hace a propósito, para que se pueda cancelar justo aquí). Sin
     * este corte, el panel subiría a su sitio mientras la transición de salida
     * lo apaga: parece que rebota al morir.
     */
    d.stop()

    /*
     * Y el cierre, SIEMPRE síncrono y SIEMPRE el mismo que usan la ✕, el velo y
     * Escape. Arrastrar no es una salida nueva, es la misma puerta con otro pomo.
     */
    dismiss()
  }

  onMounted(() => {
    if (!wrap.value || !handle.value) return

    wrap.value.addEventListener('mousedown', guard, true)
    wrap.value.addEventListener('touchstart', guard, true)
    document.addEventListener('touchcancel', onTouchCancel, true)

    draggable = createDraggable(wrap.value, {
      trigger: handle.value,
      // solo el eje Y
      x: false,
      /*
       * Tope seco hacia arriba: el panel no sube por encima de su sitio.
       *
       * El modificador TIENE que ser idempotente: anime.js lo aplica también al
       * valor de partida de la vuelta (y en cada lectura de la propiedad), así
       * que uno que escalara —hacer aquí la elasticidad a mano, por ejemplo— se
       * aplicaría dos veces y el panel daría un salto al soltar. Un tope no.
       */
      y: { modifier: (v) => (v < 0 ? 0 : v) },
      /*
       * El sitio del panel ES el límite, y hacia abajo se sale de él con
       * resistencia. No es una aproximación del dragElastic: 0.55 de motion-v,
       * es la misma fórmula — anime.js calcula `limite + (v - limite) * (1 -
       * containerFriction)`. Y en su forma de ARRAY (y no un elemento) apaga
       * además todo el autoscroll de la librería, que aquí no queremos.
       */
      container: [0, 0, 0, 0],
      containerFriction: 0.45,
      // sin inercia más allá del límite al soltar: es el dragMomentum: false de
      // antes. Con 1 la proyección por velocidad se queda en cero.
      releaseContainerFriction: 1,
      releaseStiffness: RELEASE.stiffness,
      releaseDamping: RELEASE.damping,
      // la vuelta va con la curva de la casa, NO con un muelle
      releaseEase: CURVE.out,
      // el cursor lo pone .modal-grab en base.css, donde vive el resto del asa
      cursor: false,
      onUpdate: fade,
      onSettle: settled,
      onRelease,
    })
  })

  onBeforeUnmount(() => {
    alive = false
    wrap.value?.removeEventListener('mousedown', guard, true)
    wrap.value?.removeEventListener('touchstart', guard, true)
    document.removeEventListener('touchcancel', onTouchCancel, true)
    // devuelve el touch-action y el transform que había escrito, y suelta los
    // listeners que la librería tiene puestos en document
    draggable?.revert()
    draggable = null
  })

  return { wrap, handle }
}
