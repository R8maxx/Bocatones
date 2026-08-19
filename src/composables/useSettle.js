import { fmt } from '../money.js'

/*
 * Confirmación de "saldar la cuenta", compartida.
 *
 * Estaba copiada literalmente en App.vue y en HistoryPanel.vue, con la misma
 * cadena de texto en los dos sitios.
 *
 * Aquí sí se mantiene un diálogo nativo a propósito: mover dinero de "debe" a
 * "pagado" no tiene deshacer barato (habría que volver a marcar cada pedido de
 * cada día), así que conviene una barrera explícita antes de actuar.
 */
export function confirmSettle(person, pending) {
  return window.confirm(`¿Marcar como pagado todo lo que debe ${person} (${fmt(pending)})?`)
}
