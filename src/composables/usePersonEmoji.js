/*
 * Asigna un emoji ESTABLE a cada persona a partir de su nombre.
 * El mismo nombre devuelve siempre el mismo emoji, en cualquier rodillo o lista.
 */

// paleta variada (caras + animales) — fácil de distinguir de un vistazo
const POOL = [
  '🦊', '🐼', '🐸', '🐵', '🐶', '🐱', '🦁', '🐯', '🐨', '🐰',
  '🐻', '🐷', '🐮', '🐔', '🐧', '🦉', '🦄', '🐲', '🐢', '🐙',
  '🦕', '🦖', '🐝', '🦋', '🐳', '🦈', '🦩', '🦦', '🦔', '🐺',
  '😎', '🤠', '🤖', '👽', '👾', '🤡', '🦸', '🥷', '🧛', '🧙',
]

// hash determinista sencillo (djb2) sobre el nombre normalizado
function hash(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0
  }
  return h
}

export function personEmoji(name) {
  const key = (name || '').trim().toLowerCase()
  if (!key) return '🥪'
  return POOL[hash(key) % POOL.length]
}