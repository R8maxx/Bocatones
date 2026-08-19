import { fmt } from '../money.js'
import { confirm } from './useConfirm.js'

/*
 * Las confirmaciones de dinero, en un solo sitio.
 *
 * Estaban copiadas literalmente en App.vue y en HistoryPanel.vue, con la misma
 * cadena de texto en los dos.
 *
 * Aquí SÍ se mantiene una barrera explícita antes de actuar: mover dinero de
 * "debe" a "pagado" no tiene deshacer barato (habría que volver a marcar cada
 * pedido de cada día). Lo que ya no es nativa es la barrera: la pinta la app
 * (useConfirm.js), así que respeta el tema, el foco y el idioma del resto.
 *
 * Las dos devuelven una promesa: `if (await confirmSettle(...))`.
 */

export function confirmSettle(person, pending) {
  return confirm({
    title: 'saldar cuenta',
    text: `¿Marcar como pagado todo lo que debe ${person}?`,
    detail: `${fmt(pending)} · no se puede deshacer de golpe`,
    confirmLabel: 'saldar',
  })
}

// variante para cobrar: aquí no se salda "todo lo que debe", solo lo que te
// debe A TI, y el diálogo tiene que decir eso o engaña.
export function confirmCollect(person, pending) {
  return confirm({
    title: 'cobrar',
    text: `¿Marcar como cobrado lo que te debe ${person}?`,
    detail: `${fmt(pending)} · solo lo de los días que pusiste tú el dinero`,
    confirmLabel: 'cobrado',
  })
}
