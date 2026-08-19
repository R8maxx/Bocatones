<script setup>
import { computed, toRef } from 'vue'
import { useCountUp } from '../composables/useCountUp.js'
import { fmt, fmtOrDash } from '../money.js'

/*
 * MoneyValue — un importe que cuenta hasta su valor nuevo en vez de saltar.
 *
 * Se hace en un componente y no en un composable suelto para poder usarlo
 * dentro de un v-for: cada importe necesita su propia interpolación.
 */

const props = defineProps({
  cents: { type: Number, default: 0 },
  dash: { type: Boolean, default: false }, // 0 € se muestra como «—»
})

const shown = useCountUp(toRef(props, 'cents'))
const text = computed(() => (props.dash ? fmtOrDash(shown.value) : fmt(shown.value)))
</script>

<template>
  <span class="money">{{ text }}</span>
</template>

<style scoped>
.money {
  /* cifras de ancho fijo: si no, el importe da saltos mientras cuenta */
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
