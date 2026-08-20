<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useClassics } from '../composables/useClassics.js'
import { useMe } from '../composables/useMe.js'
import { usePeople } from '../composables/usePeople.js'
import { api } from '../api.js'
import { toInput, parse } from '../money.js'

const emit = defineEmits(['add'])
const { classics, loading: classicsLoading, addClassic, removeClassic, priceFor } = useClassics()

const { me, setMe } = useMe()

const person = ref('')
const filling = ref('')
const bread = ref('')
const notes = ref('')
const size = ref('whole') // 'whole' = entero | 'half' = media
const price = ref('') // en euros y como texto ("3,50"); vacío = usa el catálogo
let priceTouched = false // si lo escribes a mano, dejamos de sobreescribirlo
const sending = ref(false) // petición en vuelo: evita el doble envío
const confirmDel = ref(null) // id del clásico esperando confirmación de borrado

// nombres ya usados: evita que la deuda se parta entre "Maria" y "maría".
// La lista es compartida (usePeople): los selectores de "hoy paga" y "hoy
// recoge" necesitan la misma, y traerla dos veces era pedir lo mismo dos veces.
const { people: knownPeople, addPerson } = usePeople()

// lo que más repite quien está escrito en el campo del nombre: cada día se
// reescribía a mano el mismo bocata teniendo meses de histórico en el servidor
const usual = ref([])
let usualTimer = null

// los habituales se piden con freno: el nombre se escribe letra a letra
function loadUsual(name) {
  clearTimeout(usualTimer)
  const who = (name || '').trim()
  if (who.length < 2) {
    usual.value = []
    return
  }
  usualTimer = setTimeout(async () => {
    try {
      usual.value = await api.usualOrders(who)
    } catch {
      usual.value = [] // es un atajo: si falla, se escribe a mano y ya está
    }
  }, 400)
}
watch(person, loadUsual)

onMounted(() => {
  person.value = me.value
  loadUsual(person.value)
})

const valid = computed(() => person.value.trim() && filling.value.trim())

// precio de catálogo para el relleno y el tamaño de ahora mismo (céntimos o null)
const suggested = computed(() => priceFor(filling.value, size.value))
const suggestedTxt = computed(() => toInput(suggested.value))

// mientras no lo toques a mano, el precio sigue al catálogo
watch(suggested, (cents) => {
  if (!priceTouched) price.value = toInput(cents)
})

// ¿el relleno escrito ya existe como clásico?
const isKnown = computed(() =>
  classics.value.some((c) => c.name.toLowerCase() === filling.value.trim().toLowerCase()),
)
const canSaveClassic = computed(() => filling.value.trim().length > 1 && !isKnown.value)

function pick(name) {
  filling.value = name
}

function saveAsClassic() {
  if (!canSaveClassic.value) return
  addClassic(filling.value)
}

// rellena el formulario con un pedido de siempre. El precio se recalcula con el
// catálogo de HOY, no con el que tuviera hace dos meses; hay que ponerlo a mano
// porque watch(suggested) solo dispara si el valor cambia.
function applyUsual(u) {
  filling.value = u.filling
  bread.value = u.bread
  notes.value = u.notes
  size.value = u.size === 'half' ? 'half' : 'whole'
  priceTouched = false
  price.value = toInput(priceFor(u.filling, u.size))
}

// el chip solo tiene sitio para el relleno: el resto va en el title
function usualTitle(u) {
  const parts = [u.size === 'half' ? '½ media' : 'entero']
  if (u.bread) parts.push(`pan: ${u.bread}`)
  if (u.notes) parts.push(u.notes)
  parts.push(`pedido ${u.times} ${u.times === 1 ? 'vez' : 'veces'}`)
  return parts.join(' · ')
}

/*
 * Enviar y ESPERAR. Antes se vaciaba el formulario en el mismo tick que se
 * emitía el evento: si el POST fallaba, el usuario veía la señal de éxito
 * (campos en blanco) y el pedido no llegaba nunca. Ahora lo escrito no se
 * toca hasta que el servidor confirma.
 */
async function submit() {
  if (!valid.value || sending.value) return
  const cents = parse(price.value)
  sending.value = true
  try {
    await emitAdd({
      person: person.value,
      filling: filling.value,
      bread: bread.value,
      notes: notes.value,
      size: size.value,
      // si lo dejas en blanco no mandamos precio: el servidor aplica el del catálogo
      ...(cents === null ? {} : { price: cents }),
    })
  } catch {
    return // el aviso ya lo ha dado el composable; los campos se conservan
  } finally {
    sending.value = false
  }

  setMe(person.value)
  addPerson(person.value)
  loadUsual(person.value) // el recuento de veces acaba de cambiar
  // el nombre se queda puesto a propósito: normalmente pides tú otra vez
  filling.value = ''
  bread.value = ''
  notes.value = ''
  size.value = 'whole'
  price.value = ''
  priceTouched = false
}

// el padre devuelve la promesa de addOrder, así sabemos si ha ido bien
function emitAdd(fields) {
  return new Promise((resolve, reject) => {
    emit('add', fields, { resolve, reject })
  })
}

// borrar un clásico arrastra su precio: se confirma en el propio chip
function askRemoveClassic(id) {
  if (confirmDel.value === id) {
    confirmDel.value = null
    removeClassic(id).catch(() => {})
  } else {
    confirmDel.value = id
    setTimeout(() => {
      if (confirmDel.value === id) confirmDel.value = null
    }, 4000)
  }
}
</script>

<template>
  <form class="form" @submit.prevent="submit">
    <div class="form-head">
      <span class="prompt">root@bocatones:~$</span>
      <span class="cmd">./añadir_pedido --nuevo</span>
    </div>

    <div class="grid">
      <label class="field">
        <span class="lbl">// quién pide</span>
        <input
          v-model="person"
          type="text"
          list="bocatones-people"
          placeholder="tu nombre"
          autocomplete="off"
          maxlength="40"
        />
        <datalist id="bocatones-people">
          <option v-for="p in knownPeople" :key="p" :value="p" />
        </datalist>
      </label>

      <label class="field">
        <span class="lbl">// relleno *</span>
        <input v-model="filling" type="text" placeholder="lomo con queso..." autocomplete="off" maxlength="60" />
      </label>

      <label class="field">
        <span class="lbl">// pan</span>
        <input v-model="bread" type="text" placeholder="barra / integral / sin gluten" autocomplete="off" maxlength="40" />
      </label>

      <label class="field">
        <span class="lbl">// extras / notas</span>
        <input v-model="notes" type="text" placeholder="sin tomate, con alioli..." autocomplete="off" maxlength="80" />
      </label>
    </div>

    <div class="size-row">
      <span class="size-lbl">// tamaño</span>
      <div class="seg" role="group" aria-label="tamaño del bocata">
        <button
          type="button"
          class="seg-btn"
          :class="{ active: size === 'half' }"
          :aria-pressed="size === 'half'"
          @click="size = 'half'"
        >½ media</button>
        <button
          type="button"
          class="seg-btn"
          :class="{ active: size === 'whole' }"
          :aria-pressed="size === 'whole'"
          @click="size = 'whole'"
        >🥖 entero</button>
      </div>

      <label class="price">
        <span class="size-lbl">// precio</span>
        <span class="price-box">
          <input
            v-model="price"
            type="text"
            inputmode="decimal"
            maxlength="7"
            :placeholder="suggestedTxt || '0,00'"
            :title="suggestedTxt ? `precio del catálogo: ${suggestedTxt} €` : 'sin precio en el catálogo'"
            aria-label="precio en euros"
            @input="priceTouched = true"
          />
          <span class="cur" aria-hidden="true">€</span>
        </span>
      </label>
    </div>

    <div v-if="usual.length" class="usual">
      <span class="quick-lbl">🔁 lo de siempre:</span>
      <TransitionGroup name="chip">
      <button
        v-for="u in usual"
        :key="`${u.filling}|${u.bread}|${u.notes}|${u.size}`"
        type="button"
        class="chip usual-chip"
        :title="usualTitle(u)"
        @click="applyUsual(u)"
      >
        <span v-if="u.size === 'half'" class="u-half" aria-hidden="true">½ </span>{{ u.filling }}
        <small class="u-times">·{{ u.times }}</small>
      </button>
      </TransitionGroup>
    </div>

    <div v-if="classicsLoading || classics.length || canSaveClassic" class="quick">
      <span class="quick-lbl">clásicos:</span>

      <span v-if="classicsLoading" class="quick-loading">cargando…</span>

      <TransitionGroup name="chip">
      <span v-for="c in classics" :key="c.id" class="chip" :class="{ arming: confirmDel === c.id }">
        <button type="button" class="chip-pick" @click="pick(c.name)">
          {{ c.name }}<small v-if="c.priceWhole !== null" class="chip-price">{{ toInput(c.priceWhole) }}€</small>
        </button>
        <button
          type="button"
          class="chip-del"
          :aria-label="confirmDel === c.id ? `confirmar borrado de ${c.name}` : `borrar clásico ${c.name}`"
          @click="askRemoveClassic(c.id)"
        >{{ confirmDel === c.id ? '¿seguro?' : '✕' }}</button>
      </span>
      </TransitionGroup>

      <Transition name="pop">
      <button
        v-if="canSaveClassic"
        type="button"
        class="chip add"
        @click="saveAsClassic"
      >+ guardar «{{ filling.trim() }}»</button>
      </Transition>
    </div>

    <button class="submit" type="submit" :disabled="!valid || sending">
      <span class="caret">►</span> {{ sending ? 'enviando…' : 'añadir al pedido' }}
    </button>
  </form>
</template>

<style scoped>
.form {
  background: var(--panel);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: clamp(0.9rem, 2vw, 1.25rem);
  box-shadow: var(--hairline), var(--shadow-md);
}

.form-head {
  display: flex;
  gap: 0.6ch;
  flex-wrap: wrap;
  font-size: var(--fs-2);
  margin-bottom: var(--sp-3);
  padding-bottom: var(--sp-2);
  border-bottom: 1px dashed var(--line-2);
}
.prompt { color: var(--ink-dim); }
.cmd { color: var(--ink); }
.cmd::after {
  content: '_';
  animation: blink 1.1s steps(1) infinite;
}
@keyframes blink { 50% { opacity: 0; } }

.grid {
  display: grid;
  /* minmax(0, …) y no 1fr: `1fr` deja que el mínimo intrínseco del <input>
     (~234px por columna) marque el suelo de la pista, y el formulario
     desbordaba a 861px sin que ninguna media query llegara */
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-2) var(--sp-3);
}
@media (max-width: 560px) {
  .grid { grid-template-columns: 1fr; }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.lbl {
  font-size: var(--fs-2);
  letter-spacing: 0.06em;
  color: var(--ink-faint);
  text-transform: uppercase;
}

input {
  /* imprescindible: un <input> sin `size` tiene un mínimo intrínseco de ~20
     caracteres (~210px), así que dos columnas 1fr no bajaban de ~439px y el
     formulario desbordaba justo por encima del breakpoint de .layout (861px),
     donde ninguna media query llegaba. */
  min-width: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.55rem 0.7rem;
  transition: border-color 0.2s, box-shadow 0.2s;
}
input::placeholder { color: var(--ink-faint); }
input:focus {
  border-color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--ink);
}

.size-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2) var(--sp-3);
  margin-top: var(--sp-3);
}

/* precio: input estrecho con el símbolo del euro dentro de la caja */
.price { display: inline-flex; align-items: center; gap: 0.7rem; }
.price-box {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.price-box input {
  width: 6.5rem;
  padding: 0.32rem 1.6rem 0.32rem 0.7rem;
  font-size: var(--fs-3);
  text-align: right;
  font-variant-numeric: tabular-nums;
  border-radius: 999px;
}
.cur {
  position: absolute;
  right: 0.7rem;
  font-size: var(--fs-2);
  color: var(--ink-faint);
  pointer-events: none;
}
.price-box input:focus + .cur { color: var(--ink); }

/* precio de catálogo dentro del chip del clásico */
.chip-price {
  margin-left: 0.5ch;
  font-size: var(--fs-1);
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}
.chip-pick:hover .chip-price { color: var(--ink-dim); }
.size-lbl {
  font-size: var(--fs-2);
  color: var(--ink-faint);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 2px;
  gap: 2px;
}
.seg-btn {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink-dim);
  background: transparent;
  border: none;
  border-radius: 999px;
  padding: 0.32rem 0.85rem;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.seg-btn:hover { color: var(--ink); }
.seg-btn.active {
  color: var(--bg);
  background: var(--ink);
  font-weight: 700;
}

.quick,
.usual {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: var(--sp-3) 0;
  /* ancla del chip que se va: al salir pasa a position:absolute para que el
     resto se deslice a su hueco en vez de dar un salto (ver .chip-leave-active) */
  position: relative;
}
.quick-lbl {
  font-size: var(--fs-2);
  color: var(--ink-faint);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.chip {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  overflow: hidden;
  transition: border-color 0.15s;
}
.chip:hover { border-color: var(--ink-dim); }
.chip-pick {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink-dim);
  background: transparent;
  border: none;
  padding: 0.28rem 0.2rem 0.28rem 0.7rem;
  cursor: pointer;
  transition: color 0.15s;
}
.chip-pick:hover { color: var(--ink); }
.chip-del {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  font-size: var(--fs-1);
  color: var(--ink-faint);
  background: transparent;
  border: none;
  padding: 0 0.55rem 0 0.35rem;
  cursor: pointer;
  transition: color 0.15s;
}
.chip-del:hover { color: var(--g1); }

/* chip de "lo de siempre": mismo cuerpo que un clásico, borde de acción como
   .chip.add, porque no es una etiqueta del catálogo sino un atajo */
.usual-chip {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  background: transparent;
  border-color: var(--line-2);
  padding: 0.28rem 0.7rem;
  min-height: var(--tap);
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.usual-chip:hover {
  color: var(--bg);
  background: var(--ink);
  border-color: var(--ink);
}
.u-times {
  margin-left: 0.4ch;
  font-size: var(--fs-1);
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}
.usual-chip:hover .u-times { color: var(--bg); }

.quick-loading { font-size: var(--fs-1); color: var(--ink-dim); }

/* clásico esperando confirmación de borrado */
.chip.arming { border-color: var(--g1); }
.chip.arming .chip-del {
  font-size: var(--fs-1);
  font-weight: 700;
  color: var(--g1);
  padding-inline: 0.5rem;
}

.chip.add {
  border-style: dashed;
  border-color: var(--ink-dim);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  background: transparent;
  padding: 0.28rem 0.7rem;
  cursor: pointer;
}
.chip.add:hover { background: var(--ink); color: var(--bg); border-style: solid; }

.submit {
  width: 100%;
  font-family: var(--mono);
  font-weight: 700;
  font-size: var(--fs-3);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--bg);
  background: var(--ink);
  border: 1px solid var(--ink);
  border-radius: var(--radius);
  padding: 0.7rem;
  cursor: pointer;
  transition: transform 0.1s, background 0.2s, color 0.2s, box-shadow 0.2s;
}
.submit .caret { display: inline-block; transform: translateY(1px); }
.submit:hover:not(:disabled) {
  box-shadow: 0 0 26px -4px var(--glow-hard);
}
.submit:active:not(:disabled) { transform: translateY(1px) scale(0.997); }
.submit:disabled {
  color: var(--ink-faint);
  background: transparent;
  border-color: var(--line-2);
  cursor: not-allowed;
}
</style>