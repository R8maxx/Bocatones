<script setup>
import { computed, ref } from 'vue'
import NumberFlow from '@number-flow/vue'
import { LOCALE, PCT_FORMAT, fmtPct } from '../money.js'
import { ROLL } from '../motion.js'

/*
 * PctValue — la probabilidad de un candidato del sorteo, rodando.
 *
 * Existe para que haya UN porcentaje y no dos: la tragaperras pintaba
 * Math.round(chance * 100) + '%' y el histórico un Intl con un decimal, para
 * el mismo dato y con distinto espaciado. El formato sale ahora de money.js,
 * como el dinero.
 *
 * Recibe la fracción (0..1) tal cual la manda el servidor, no el 0-100: el
 * estilo percent de Intl ya multiplica, y si multiplicáramos aquí volveríamos
 * a tener dos sitios donde equivocarse con el factor.
 */

const props = defineProps({
  chance: { type: Number, default: 0 },
})

const n = computed(() => (Number.isFinite(props.chance) ? props.chance : 0))

/*
 * El valor en texto plano, solo para lectores de pantalla. NumberFlow pinta los
 * dígitos en un shadow root sin marcar nada como aria-hidden, así que el
 * rodillo entero (0123456789…) queda como texto vivo y el número real se pierde
 * en el árbol de accesibilidad. Va en el aria-label del envoltorio, no en un
 * span oculto, para que el porcentaje no salga dos veces al copiar. Ver la
 * nota larga en MoneyValue.
 */
const plain = computed(() => fmtPct(n.value))

const hot = ref(false)
</script>

<template>
  <span class="pct" role="img" :aria-label="plain">
    <NumberFlow
      aria-hidden="true"
      class="nf"
      :class="{ 'nf-hot': hot }"
      :value="n"
      :locales="LOCALE"
      :format="PCT_FORMAT"
      v-bind="ROLL"
      @animationsstart="hot = true"
      @animationsfinish="hot = false"
    />
  </span>
</template>

<style scoped>
.pct {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
