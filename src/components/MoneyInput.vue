<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useAttrs, watch } from 'vue'
import NumberFlow from '@number-flow/vue'
import { AMOUNT_FORMAT, LOCALE, parse } from '../money.js'
import { ROLL, prefersReduced } from '../motion.js'

/*
 * MoneyInput — una caja de precio en euros cuya cifra RUEDA cuando aparece o
 * cambia sola.
 *
 * Es el hermano editable de MoneyValue. El problema que resuelve: un importe
 * dentro de un <input> no se puede animar — el texto de un input no tiene
 * dígitos que mover, así que los tres precios editables de la app (el del
 * formulario, y el entero y la media del catálogo) se rellenaban de golpe. Al
 * pulsar un clásico el precio simplemente APARECÍA, sin decir de dónde salía.
 *
 * Cómo: dos capas en el mismo hueco. Debajo, el <input> de verdad, que es quien
 * tiene el valor, el foco y lo que leen los lectores de pantalla. Encima, un
 * NumberFlow decorativo (aria-hidden) con la misma cifra. Mientras no tienes el
 * campo enfocado se ve el rodillo y el texto del input va en transparente; al
 * enfocar se apagan las capas al revés y escribes en el input pelado. El cambio
 * es INSTANTÁNEO a propósito: un fundido entre las dos capas se leería como que
 * el número se mueve al enfocar, y no se mueve.
 *
 * Las dos capas no pueden divergir porque las dos salen del mismo texto y el
 * formato del rodillo (AMOUNT_FORMAT) es exactamente lo que escribe toInput().
 *
 * El € NO lo pinta el rodillo aunque Intl sepa: va aparte, dentro de la caja,
 * como ya estaba en los tres sitios. Con style:'currency' es-ES le mete además
 * un espacio duro delante, así que la cifra bailaría respecto al input.
 */

const props = defineProps({
  // el precio en euros y COMO TEXTO ("3,50"), igual que lo que da toInput()
  modelValue: { type: String, default: '' },
  // rodar desde 0 al montarse. Para lo que nace ya a la vista: los precios del
  // catálogo cuando se abre su modal. Sin esto no se moverían: NumberFlow no
  // anima al montarse, la cifra nace donde le toca y ahí se queda.
  rollIn: { type: Boolean, default: false },
  // retardo del rodillo de `rollIn`, en ms. Existe para no rodar debajo de la
  // entrada de un panel: si el modal tarda --dur-3 en entrar, la cifra que rueda
  // durante ese rato se la come el fundido.
  delay: { type: Number, default: 0 },
  // petición en vuelo: la caja se apaga y no se toca
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const cents = computed(() => parse(props.modelValue))
// vacío o ilegible no es 0 €: es que no hay cifra, y entonces manda el
// placeholder del input (el precio automático de la media, un "0,00" de pista…)
const has = computed(() => cents.value !== null)
const euros = computed(() => (cents.value ?? 0) / 100)

const focused = ref(false)
const hot = ref(false)

/*
 * `zero` es el arranque de una aparición: el rodillo nace en 0 y SUBE hasta el
 * valor real un tick después. Es el único modo de que se mueva una cifra que
 * antes no estaba, y hay que armarlo antes de que el elemento exista — de ahí
 * que `rollIn` se lea ya en el setup y que el watch de abajo sea pre-flush (el
 * de serie): así el <NumberFlow> se crea con el 0 puesto, no con el valor.
 */
const zero = ref(props.rollIn && !prefersReduced())
const shown = computed(() => (zero.value ? 0 : euros.value))

let timer = null
function settle(ms) {
  clearTimeout(timer)
  timer = setTimeout(() => {
    zero.value = false
  }, ms)
}

onMounted(() => {
  if (zero.value) settle(props.delay)
})
onBeforeUnmount(() => clearTimeout(timer))

// la cifra que aparece al pulsar un clásico o un "lo de siempre". Enfocado no:
// ahí el número lo estás escribiendo tú y el rodillo está tapado de todas formas.
watch(has, (now) => {
  if (!now || focused.value || prefersReduced()) return
  zero.value = true
  settle(0) // un tick, lo justo para que el rodillo nazca en 0
})

function onInput(e) {
  emit('update:modelValue', e.target.value)
}

/*
 * Los atributos de fuera (placeholder, aria-label, title, @change, @blur…) van
 * al <input>, que es el elemento de verdad. Pero `class` y `style` NO: ahí es
 * donde llega el --mi-w de cada sitio, y tiene que caer en la envoltura, que es
 * quien tiene el ancho. Sin este reparto el ancho se quedaba en el input, que
 * mide el 100% de una envoltura que seguía en su valor por defecto.
 */
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const inputAttrs = computed(() => {
  const { class: _c, style: _s, ...rest } = attrs
  return rest
})
</script>

<template>
  <span class="mi" :class="[$attrs.class, { busy }]" :style="$attrs.style">
    <input
      type="text"
      inputmode="decimal"
      maxlength="7"
      class="mi-input"
      :class="{ quiet: has && !focused }"
      v-bind="inputAttrs"
      :value="modelValue"
      @input="onInput"
      @focus="focused = true"
      @blur="focused = false"
    />
    <!--
      El rodillo es DECORACIÓN: el valor lo tiene el input, que es quien está en
      el árbol de accesibilidad. Ver la nota larga de MoneyValue sobre por qué
      esto tiene que ir aria-hidden.
    -->
    <span v-if="has" class="mi-flow" :class="{ off: focused }" aria-hidden="true">
      <NumberFlow
        class="nf"
        :class="{ 'nf-hot': hot }"
        :value="shown"
        :locales="LOCALE"
        :format="AMOUNT_FORMAT"
        v-bind="ROLL"
        @animationsstart="hot = true"
        @animationsfinish="hot = false"
      />
    </span>
    <span class="mi-cur" aria-hidden="true">€</span>
  </span>
</template>

<style scoped>
/*
 * El ancho se pide de fuera con --mi-w: cada sitio tiene el suyo (una columna
 * de rejilla en el catálogo, una caja fija en el formulario) y era lo único que
 * cambiaba entre los tres precios editables que había copiados a mano.
 */
.mi {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: var(--mi-w, 6.5rem);
  /* el mismo relleno para las dos capas: si se separan, la cifra da un salto
     lateral al enfocar */
  --pad-y: 0.3rem;
  --pad-r: 1.5rem;
  --pad-l: 0.7rem;
}

.mi-input {
  width: 100%;
  min-width: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: var(--pad-y) var(--pad-r) var(--pad-y) var(--pad-l);
  transition: border-color var(--dur-1) var(--ease-out);
}
.mi-input::placeholder { color: var(--ink-faint); }
.mi-input:focus { border-color: var(--ink); }

/* con el rodillo delante, el texto del input se calla pero el cursor no: si
   alguien enfoca con teclado tiene que ver dónde va a escribir */
.mi-input.quiet { color: transparent; }
.mi-input.quiet::selection { background: transparent; }

.mi-flow {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  /* +1px por el borde del input: la capa se apoya en el borde exterior */
  padding: calc(var(--pad-y) + 1px) calc(var(--pad-r) + 1px) calc(var(--pad-y) + 1px) var(--pad-l);
  font-size: var(--fs-3);
  font-variant-numeric: tabular-nums;
  /* el clic lo tiene que recibir el input de debajo, siempre */
  pointer-events: none;
}
/* enfocado manda el input: el rodillo se apaga en seco, sin fundido */
.mi-flow.off { opacity: 0; }

.mi-cur {
  position: absolute;
  right: 0.65rem;
  font-size: var(--fs-2);
  color: var(--ink-faint);
  pointer-events: none;
}
.mi:focus-within .mi-cur { color: var(--ink); }

/* guardando: se ve que la petición está en vuelo */
.mi.busy .mi-input { border-color: var(--ink-dim); }
.mi.busy { opacity: 0.6; }
</style>
