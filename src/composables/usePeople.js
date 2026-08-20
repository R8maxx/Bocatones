import { ref } from 'vue'
import { api } from '../api.js'

/*
 * usePeople — la gente que ya ha pedido alguna vez, compartida.
 *
 * El formulario ya se traía esta lista para autocompletar el nombre, pero la
 * guardaba en su propio ref. En cuanto hubo un segundo sitio que necesitaba
 * nombres —los selectores de "hoy paga" y "hoy recoge"— hacía falta o una
 * segunda petición idéntica o subirla aquí.
 *
 * Y hacía falta de verdad, no por elegancia: esos selectores se alimentaban
 * SOLO de los pedidos del día. Un día con deuda arrastrada pero sin pedidos
 * todavía dejaba la lista vacía, y un <select> sin opciones no se puede ni
 * usar ni cerrar.
 *
 * Se carga una vez y se refresca sola cuando alguien nuevo pide (addPerson),
 * que es la única forma en que esta lista crece.
 */

const people = ref([])
let loaded = false

async function load(force = false) {
  if (loaded && !force) return
  loaded = true
  try {
    people.value = await api.listPeople()
  } catch {
    // es una ayuda para escribir, no un dato crítico: sin ella se teclea a mano
    loaded = false
  }
}

export function usePeople() {
  if (typeof window !== 'undefined') load()

  // alguien acaba de pedir: que aparezca ya, sin esperar a la siguiente carga
  function addPerson(name) {
    const n = (name || '').trim()
    if (!n) return
    const k = n.toLowerCase()
    if (people.value.some((p) => p.toLowerCase() === k)) return
    people.value = [n, ...people.value]
  }

  /*
   * Une los nombres de hoy con los conocidos, sin repetir por mayúsculas
   * (misma normalización que usa el servidor: LOWER()). Los de hoy van
   * primero porque son los candidatos probables.
   */
  function withKnown(todayNames = []) {
    const seen = new Set()
    const out = []
    for (const n of [...todayNames, ...people.value]) {
      const name = (n || '').trim()
      const k = name.toLowerCase()
      if (name && !seen.has(k)) {
        seen.add(k)
        out.push(name)
      }
    }
    return out
  }

  return { people, addPerson, withKnown, load }
}
