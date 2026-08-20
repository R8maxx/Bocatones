import { ref, watch } from 'vue'

/*
 * useInlineEdit — el patrón "texto → ✎ → selector" que se repite cuatro veces
 * (hoy: quién paga y quién recoge; histórico: quién recogió y quién pagó).
 *
 * Existe por un fallo concreto, no por quitar repetición: el selector se abría
 * con un booleano y su ÚNICA forma de volver a cerrarse era el evento `change`.
 * Como el <select> no llevaba `:value`, el navegador dejaba preseleccionada la
 * primera opción, así que volver a elegir esa misma opción no disparaba `change`
 * y no había manera de salir sin cambiar el pagador. Con la lista de personas
 * vacía no había ni siquiera una opción que pudiera cerrarlo.
 *
 * Aquí las salidas son tres y ninguna toca los datos: Escape, el botón ✕ y
 * quitar el foco (que es el "clic fuera" sin instalar listeners globales).
 *
 * El foco tiene truco. Enfocar en un nextTick al abrir NO vale: el relevo de la
 * portada va con <Transition mode="out-in">, así que primero se va el texto y el
 * select no se monta hasta que esa salida termina. En el nextTick el ref sigue
 * vacío, no se enfoca nada, y sin foco la tecla Escape no llega a ninguna parte.
 *
 * Por eso el disparador es el propio ref: se enfoca cuando el elemento aparece,
 * tarde lo que tarde. Sirve igual con transición y sin ella.
 */

export function useInlineEdit() {
  const editing = ref(false)
  const el = ref(null)

  function open() {
    editing.value = true
  }

  /*
   * Dentro de un v-for (las filas del histórico) Vue guarda los refs en un
   * array en vez de en el elemento, así que hay que desenvolverlo.
   */
  watch(el, (node) => {
    if (!editing.value) return
    const target = Array.isArray(node) ? node[0] : node
    target?.focus()
  })

  function cancel() {
    editing.value = false
  }

  /*
   * El blur se aplaza un tick a propósito: al pulsar el botón ✕ el navegador
   * dispara primero el blur del <select> y sólo después el click. Sin este
   * respiro, cancel() desmontaría el botón antes de que su click llegase, y
   * daría igual: el resultado es el mismo (cerrar sin cambiar nada), pero
   * aplazarlo evita que el mismo gesto se procese dos veces.
   */
  function blur() {
    setTimeout(() => {
      editing.value = false
    }, 0)
  }

  // elegir en el desplegable: aplica y cierra
  function choose(e, apply) {
    editing.value = false
    apply(e.target.value)
  }

  return { editing, el, open, cancel, blur, choose }
}
