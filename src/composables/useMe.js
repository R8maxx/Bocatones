import { ref } from 'vue'

/*
 * useMe — quién eres tú en una lista compartida.
 *
 * El nombre ya se guardaba en localStorage, pero solo lo usaba el formulario
 * para no tener que reescribirlo. Aquí pasa a ser estado compartido, para poder
 * distinguir lo tuyo del resto: tu pedido en la cola, tu deuda en la cuenta y
 * tu nombre en el sorteo.
 *
 * Se marca con peso tipográfico y un borde, no con un color nuevo: la regla de
 * la casa es que el color vive en el movimiento y en los estados.
 */

const KEY = 'bocatones:me'

function read() {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return '' // modo privado
  }
}

const me = ref(read())

export function useMe() {
  function setMe(name) {
    const v = (name || '').trim()
    me.value = v
    try {
      localStorage.setItem(KEY, v)
    } catch {
      /* modo privado: solo vive en memoria */
    }
  }

  // comparación insensible a mayúsculas, igual que hace el servidor
  const isMe = (name) => {
    const mine = me.value.trim().toLowerCase()
    return !!mine && (name || '').trim().toLowerCase() === mine
  }

  return { me, setMe, isMe }
}
