<script setup>
import { computed, ref } from 'vue'
import NumberFlow from '@number-flow/vue'
import { EUR_FORMAT, LOCALE, fmt } from '../money.js'
import { ROLL } from '../motion.js'

/*
 * MoneyValue — un importe que RUEDA hasta su valor nuevo en vez de saltar.
 *
 * Se hace en un componente y no en un composable suelto para poder usarlo
 * dentro de un v-for: cada importe necesita su propia animación.
 *
 * Antes esto interpolaba los céntimos a mano (useCountUp) y reformateaba la
 * cadena entera en cada frame. Servía —se veía QUÉ número se había movido sin
 * tener que buscarlo— pero movía TODOS los dígitos a la vez, incluidos los que
 * no habían cambiado, y de paso pasaba por importes que no existen: para llegar
 * a 3,50 € cruzaba 3,21 € y 3,44 €. Ahora gira solo la rueda que toca.
 *
 * El formato NO se decide aquí: las opciones salen de money.js, las mismas con
 * las que se construye fmt(), así que no pueden divergir. Los tiempos salen de
 * motion.js. Este fichero solo cablea las dos cosas y enciende la cifra
 * mientras se mueve.
 *
 * El <span class="money"> de fuera se queda por tres razones: App.vue lo pinta
 * con :deep(.money), le da un strut de texto a las filas alineadas por baseline
 * (NumberFlow fuerza line-height: 1 en su elemento), y es donde vive el
 * tabular-nums.
 */

const props = defineProps({
  cents: { type: Number, default: 0 },
  dash: { type: Boolean, default: false }, // 0 € se muestra como «—»
})

// mismo saneado que fmt(): lo que no es finito vale 0, no NaN
const euros = computed(() => (Number.isFinite(props.cents) ? props.cents : 0) / 100)

/*
 * El guion no se anima: NumberFlow solo sabe de números, así que se cambia de
 * golpe igual que hacía fmtOrDash(). Sin <Transition> a propósito: un fundido
 * cruzado entre «—» y una cifra pelearía con el propio rodillo, y con
 * mode="out-in" el importe tardaría el doble en aparecer. Y no deja hueco: los
 * dos sitios con `dash` están en columnas de rejilla con suelo (minmax), así
 * que la columna no se cierra.
 */
const isDash = computed(() => props.dash && euros.value === 0)

// se enciende mientras rueda y se enfría solo (ver .nf / .nf-hot en base.css)
const hot = ref(false)

/*
 * El importe en texto plano, solo para lectores de pantalla.
 *
 * NumberFlow pinta los dígitos dentro de un shadow root y NO marca nada como
 * aria-hidden: el rodillo lleva las diez cifras (0123456789…) como texto vivo,
 * así que sin esto el árbol de accesibilidad se quedaba sin el importe — la
 * fila «te debe 9,00 € a Alba» se anunciaba como «te debe a Alba». Antes, con
 * un span de texto normal, se leía bien; esto lo devuelve.
 *
 * Va en el aria-label del envoltorio y NO en un span oculto: un segundo nodo
 * de texto con el importe se cuela al copiar la fila (aria-hidden no excluye
 * del portapapeles) y salía «5,00 €5,00 €». Así el valor está una sola vez en
 * el DOM y sigue anunciándose.
 */
const plain = computed(() => fmt(props.cents))
</script>

<template>
  <span
    class="money"
    :role="isDash ? undefined : 'img'"
    :aria-label="isDash ? undefined : plain"
  >
    <template v-if="isDash">—</template>
    <NumberFlow
      v-else
      aria-hidden="true"
      class="nf"
      :class="{ 'nf-hot': hot }"
      :value="euros"
      :locales="LOCALE"
      :format="EUR_FORMAT"
      v-bind="ROLL"
      @animationsstart="hot = true"
      @animationsfinish="hot = false"
    />
  </span>
</template>

<style scoped>
.money {
  /* cifras de ancho fijo: si no, el importe da saltos mientras rueda */
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
