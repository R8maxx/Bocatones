// dinero en céntimos: el servidor guarda enteros, la UI habla en euros.
// todo el formato y el parseo pasa por aquí para no repetir comas ni redondeos.

// el idioma de la app, que ahora hace falta también como prop
export const LOCALE = 'es-ES'

/*
 * Las opciones SUELTAS, además del formateador ya montado.
 *
 * NumberFlow no sabe recibir un Intl.NumberFormat: quiere `locales` y `format`
 * en crudo para poder trocear el número en dígitos. Si se copiaran las opciones
 * al componente, el mismo importe se vería de dos formas en cuanto una de las
 * dos copias cambiara. Así que EUR se construye CON ellas: no pueden divergir.
 */
export const EUR_FORMAT = { style: 'currency', currency: 'EUR' }
const EUR = new Intl.NumberFormat(LOCALE, EUR_FORMAT)

/*
 * El importe PELADO: dos decimales, sin moneda y sin miles.
 *
 * Es el formato de las cajas de precio editables (MoneyInput), donde el € ya
 * está pintado aparte dentro de la caja. Con style:'currency' saldría dos veces,
 * y es-ES le mete además un espacio duro delante, así que la cifra bailaría
 * respecto al texto del input que tiene debajo.
 *
 * Es EXACTAMENTE lo que escribe toInput() —"3,50"— y tiene que seguir siéndolo:
 * las dos cosas se ven en el mismo hueco, una encima de la otra.
 *
 * useGrouping: false por lo mismo que en NumValue. En es-ES el punto de los
 * miles no aparece hasta la quinta cifra, pero toInput() no agrupa NUNCA, y con
 * maxlength=7 se puede escribir "12345,6".
 */
export const AMOUNT_FORMAT = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
}

/*
 * Porcentajes del sorteo. Había DOS formatos para el mismo dato: en la
 * tragaperras un Math.round(x * 100) + '%' y en el histórico un Intl con un
 * decimal. Gana el entero, y no por gusto: la columna del % es una pista fija
 * de 2.4rem (SlotMachine .odd), donde "23,4 %" no cabe. Además el decimal no
 * cambia ninguna decisión y rodando no pararía de moverse en cada fila cada
 * vez que alguien se marca fuera.
 *
 * es-ES mete un espacio duro antes del %: "23 %", no "23%".
 */
export const PCT_FORMAT = { style: 'percent', maximumFractionDigits: 0 }
const PCT = new Intl.NumberFormat(LOCALE, PCT_FORMAT)

// 0.234 -> "23 %"
export function fmtPct(chance) {
  const n = Number(chance)
  return PCT.format(Number.isFinite(n) ? n : 0)
}

// 350 -> "3,50 €"
export function fmt(cents) {
  const n = Number(cents)
  return EUR.format(Number.isFinite(n) ? n / 100 : 0)
}

// igual, pero los importes vacíos se ven como un guion (paneles y recuentos)
export function fmtOrDash(cents) {
  const n = Number(cents)
  return Number.isFinite(n) && n !== 0 ? EUR.format(n / 100) : '—'
}

// para rellenar un input: 350 -> "3,50" · null -> ''
export function toInput(cents) {
  const n = Number(cents)
  if (cents === null || cents === undefined || cents === '' || !Number.isFinite(n)) return ''
  return (n / 100).toFixed(2).replace('.', ',')
}

// "3,50" | "3.5" | "3 €" -> 350 · vacío o ilegible -> null
export function parse(txt) {
  if (typeof txt === 'number') return Number.isFinite(txt) && txt >= 0 ? Math.round(txt * 100) : null
  const clean = String(txt ?? '')
    .trim()
    .replace(/[^\d.,]/g, '')
    .replace(',', '.')
  if (!clean) return null
  const n = Number(clean)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}
