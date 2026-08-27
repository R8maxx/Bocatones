/*
 * El puente con anime.js.
 *
 * anime.js mueve DOS cosas en esta app y nada más:
 *
 *  1) los gestos — tirar del panel de un modal para cerrarlo, deslizar un aviso
 *     para descartarlo y tirar de la palanca de la tragaperras;
 *  2) los bucles de JS que antes estaban hechos a mano con rAF y setInterval
 *     (el glitch del título, la secuencia del sorteo).
 *
 * Todo lo demás sigue siendo CSS (@keyframes y las clases de <Transition> en
 * base.css) y las cifras siguen siendo NumberFlow. La frontera de la casa no ha
 * cambiado al cambiar de librería: SI NO LO MUEVE UN DEDO Y NO ES UN BUCLE, NO
 * ES ANIME.JS.
 *
 * Este fichero existe para que la librería hable el idioma del proyecto: las
 * duraciones y las curvas salen de motion.js, que a su vez es el espejo de los
 * tokens de base.css. Así una animación de anime.js escrita sin parámetros ya se
 * mueve como el resto de la app, en vez de con los valores de fábrica de la
 * librería (1000ms y `out(2)`).
 *
 * Y NO vive dentro de motion.js a propósito: ese fichero lo importan useReveal y
 * los cuatro componentes de NumberFlow, y dice por escrito que no depende de
 * ninguna librería de animación. Sigue siendo verdad.
 */

/*
 * Se importa del paquete entero y no de sus submodulos (animejs/draggable,
 * animejs/timer...) porque MEDIDO no cambia nada: el arrastre ya arrastra
 * consigo el nucleo, la animacion, el temporizador, las curvas y las utilidades,
 * asi que el bundle sale byte a byte igual y los submodulos solo hacen los
 * imports mas largos.
 */
import { cubicBezier, engine, spring } from 'animejs'
import { BEZIER, DUR } from './motion.js'

/*
 * Las curvas de la casa en el formato de anime.js. Los ocho números NO se
 * repiten aquí: salen de BEZIER (motion.js), que es de donde también salen las
 * cadenas `cubic-bezier(...)` de WAAPI.
 */
export const CURVE = {
  out: cubicBezier(...BEZIER.out),
  inout: cubicBezier(...BEZIER.inout),
  pop: cubicBezier(...BEZIER.pop),
}

/*
 * El muelle de la palanca de la tragaperras.
 *
 * Los mismos dos números que tenía el useSpring de motion-v, y por el mismo
 * motivo que están escritos en SlotMachine: una palanca de tragaperras ES un
 * objeto con muelle. Es lo único blando que se permite en toda la app.
 *
 * Vive aquí y no en el componente porque el arrastre y el clic tienen que usar
 * EL MISMO muelle: que los dos caminos se sientan igual es justo el punto.
 */
export const LEVER = { stiffness: 520, damping: 32 }
export const LEVER_SPRING = spring(LEVER)

/*
 * Los valores por defecto del motor, una vez, al cargar el módulo.
 *
 * `duration` y `ease` son los de una entrada normal (--dur-3 + --ease-out), los
 * mismos que usan las transiciones de CSS.
 *
 * `engine.pauseOnDocumentHidden` NO se toca: viene en `true` de fábrica, y es
 * exactamente lo que queremos. Un bucle de anime.js no gasta batería en una
 * pestaña que nadie mira, y al volver no se "adelanta" para recuperar el tiempo
 * perdido. Ojo: eso vale para lo que mueve anime.js, no para los @keyframes de
 * CSS — las 16 bombillas de la tragaperras siguen siendo CSS y siguen
 * necesitando su propio visibilitychange (ver SlotMachine).
 * Si algún día hace falta ver una animación en una pestaña en segundo plano
 * (una prueba automatizada, por ejemplo), se pone a false DESDE FUERA, no aquí.
 *
 * OJO con lo que estos valores NO tocan: la vuelta de un arrastre (Draggable)
 * NO usa `duration` ni `ease` de aquí. Su duración sale de los parámetros del
 * muelle de soltada (releaseStiffness/releaseDamping) INCLUSO cuando se le pasa
 * una curva normal en releaseEase — así está escrito en draggable.js. Si un
 * arrastre vuelve demasiado lento, el mando está allí, no en esta línea.
 */
engine.defaults.duration = DUR.d3
engine.defaults.ease = CURVE.out
