<script setup>
import { computed, ref } from 'vue'
import NumberFlow from '@number-flow/vue'
import { LOCALE } from '../money.js'
import { ROLL } from '../motion.js'

/*
 * NumValue — un contador entero que rueda. El hermano seco de MoneyValue: sin
 * decimales, sin moneda y sin guion.
 *
 * `pad` sustituye a los String(n).padStart(2, '0') que había copiados a mano:
 * minimumIntegerDigits hace exactamente lo mismo (7 -> "07", 123 -> "123")
 * pero además deja que la decena sea una rueda de verdad en vez de un cero
 * pegado con cinta.
 *
 * useGrouping: false a propósito. En es-ES el punto de los miles no aparece
 * hasta la quinta cifra, así que sin esto un contador que pasara de 9999 se
 * vería "12.345" — algo que el padStart al que sustituye nunca hacía.
 *
 * Solo se pone donde el número CAMBIA estando a la vista. NumberFlow no anima
 * al montarse, así que un contador que llega con su valor final y no se mueve
 * más (las veces que alguien ha ido, los bocatas de un día del histórico) no
 * gana nada y se queda como texto: sería un shadow root por fila para nada.
 */

const props = defineProps({
  value: { type: Number, default: 0 },
  pad: { type: Number, default: 1 }, // dígitos mínimos · 2 = "07"
})

const n = computed(() => (Number.isFinite(props.value) ? props.value : 0))
const format = computed(() => ({ minimumIntegerDigits: props.pad, useGrouping: false }))

/*
 * El valor en texto plano, solo para lectores de pantalla. NumberFlow pinta los
 * dígitos en un shadow root sin marcar nada como aria-hidden, así que el
 * rodillo entero (0123456789…) queda como texto vivo y el número real se pierde
 * en el árbol de accesibilidad. Va en el aria-label del envoltorio, no en un
 * span oculto, para que el número no salga dos veces al copiar. Ver la nota
 * larga en MoneyValue.
 */
// padStart es exactamente lo que hace minimumIntegerDigits + useGrouping:false
const plain = computed(() => String(n.value).padStart(props.pad, '0'))

const hot = ref(false)
</script>

<template>
  <span class="num" role="img" :aria-label="plain">
    <NumberFlow
      aria-hidden="true"
      class="nf"
      :class="{ 'nf-hot': hot }"
      :value="n"
      :locales="LOCALE"
      :format="format"
      v-bind="ROLL"
      @animationsstart="hot = true"
      @animationsfinish="hot = false"
    />
  </span>
</template>

<style scoped>
.num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
