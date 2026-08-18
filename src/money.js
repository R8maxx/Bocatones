// dinero en céntimos: el servidor guarda enteros, la UI habla en euros.
// todo el formato y el parseo pasa por aquí para no repetir comas ni redondeos.

const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

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
