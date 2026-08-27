/*
 * Tokens de movimiento en JS, y el estado de «movimiento reducido».
 *
 * Existe por una razón técnica concreta: NumberFlow no anima con transiciones
 * CSS, anima con la Web Animations API, y WAAPI no sabe leer var(--dur-3).
 * Necesita números y strings de verdad. Los tokens viven en CSS, así que hace
 * falta un espejo en JS.
 *
 * Sí, los valores están escritos dos veces. Es a propósito, y es lo que ya se
 * hace en este proyecto cuando no hay otra: base.css:100 declara --glow-soft
 * dos veces, y SlotMachine repite la paleta. SI SE TOCA EL BLOQUE «Movimiento»
 * DE base.css (--dur-*, --ease-* y --stagger), SE
 * TOCA ESTO — no hay nada que lo compruebe por ti.
 *
 * Mismo papel que money.js con el dinero: un único sitio del que sale el dato.
 */
import { ref } from 'vue'

// --dur-1..4 del bloque «Movimiento» de base.css, en milisegundos (que es lo
// que quiere NumberFlow)
export const DUR = { d1: 150, d2: 240, d3: 340, d4: 480 }

// --stagger de base.css, en ms: lo que se retrasa cada fila de una lista
// que entra escalonada. En CSS lo usa OrderList; en JS, el rodillo de los
// precios del catálogo, que entra fila a fila con el panel.
export const STAGGER = 55

/*
 * --ease-* de base.css, pero en NÚMEROS.
 *
 * Los cuatro puntos de control, no la cadena, porque hay dos consumidores que
 * los quieren en formatos distintos: WAAPI (NumberFlow) quiere el
 * `cubic-bezier(...)` de CSS y anime.js quiere `cubicBezier(x1, y1, x2, y2)`.
 * Escritos una vez aquí y derivados abajo, así no hay una TERCERA copia de los
 * mismos ocho números en src/animate.js.
 */
export const BEZIER = {
  out: [0.2, 0.8, 0.2, 1],
  inout: [0.2, 0.9, 0.2, 1],
  pop: [0.2, 1.5, 0.4, 1],
}

// las mismas curvas como cadena de CSS, que es lo que quiere WAAPI
export const EASE = {
  out: `cubic-bezier(${BEZIER.out.join(', ')})`,
  inout: `cubic-bezier(${BEZIER.inout.join(', ')})`,
  pop: `cubic-bezier(${BEZIER.pop.join(', ')})`,
}

/*
 * prefers-reduced-motion, UNA vez y REACTIVO.
 *
 * Estaba copiado en cuatro sitios (useReveal, GlitchTitle, SlotMachine y el
 * difunto useCountUp) y las cuatro copias leían matchMedia().matches sin
 * suscribirse nunca a `change`: cambiar el ajuste del sistema con la app
 * abierta no hacía NADA hasta recargar. En la tragaperras eso no es cuestión
 * de gusto, son 16 bombillas parpadeando (ver el aviso de SlotMachine).
 *
 * Un solo MediaQueryList compartido, como el IntersectionObserver de useReveal.
 * Aquí no se importa ninguna librería de animación a propósito: así useReveal
 * y GlitchTitle siguen sin depender de nada para esto.
 */
const mql =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null

export const reducedMotion = ref(mql ? mql.matches : false)
// addEventListener y no .onchange: no se pisa a nadie que ya estuviera escuchando
mql?.addEventListener?.('change', (e) => {
  reducedMotion.value = e.matches
})

// para las guardas dentro de una función, donde estorba desenvolver el ref
export const prefersReduced = () => reducedMotion.value

/*
 * Cómo rueda una cifra. La idea es un odómetro de terminal: SECO, no un muelle.
 *
 *  - transform y spin van al MISMO tiempo (--dur-3) y con la misma curva que
 *    todo lo demás. Nada de --ease-pop aquí: el rebote es lo único que
 *    rompería el gesto, y está reservado a chips e insignias (base.css:298).
 *  - la opacidad va A CORTE, con steps(2): un dígito que entra no se funde,
 *    aparece. Es lo que hace que se lea a mecanismo y no a animación blanda,
 *    y sale gratis porque una opacidad a medias no deja rastro.
 *
 * NO se usa steps() en el GIRO, aunque sea la tentación obvia. Cada rueda
 * recorre una distancia distinta (del 7 al 2 no son los mismos dígitos que del
 * 9 al 0), así que los escalones no caen sobre los límites de las cifras: se
 * quedarían MEDIOS dígitos congelados. Eso no se lee como un mecanismo, se lee
 * como un fallo de pintado. Lo seco lo dan la duración corta, --ease-out (que
 * ya frena en seco) y el corte de la opacidad.
 */
export const ROLL = {
  transformTiming: { duration: DUR.d3, easing: EASE.out },
  spinTiming: { duration: DUR.d3, easing: EASE.out },
  opacityTiming: { duration: DUR.d1, easing: 'steps(2, jump-none)' },
}
