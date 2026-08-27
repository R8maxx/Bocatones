<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { toInput, parse } from '../money.js'
import MoneyValue from './MoneyValue.vue'
import MoneyInput from './MoneyInput.vue'
import { useMe } from '../composables/useMe.js'
import { usePeople } from '../composables/usePeople.js'

defineProps({
  orders: { type: Array, required: true },
  freshIds: { type: Object, default: () => new Set() },
  readonly: { type: Boolean, default: false }, // en el histórico solo se toca el pago
})
const emit = defineEmits(['remove', 'update', 'paid'])

const { isMe } = useMe()

/*
 * La misma lista de nombres que el formulario de alta. Corregir un nombre mal
 * escrito es justo el motivo por el que se edita un pedido, y hasta ahora era
 * el unico sitio donde se escribia a ciegas: sin el datalist, arreglar "maria"
 * podia dejar un tercer nombre nuevo y partir la deuda otra vez (ver el
 * comentario de OrderForm sobre Maria/maria).
 */
const { people: knownPeople } = usePeople()

const editingId = ref(null)
const draft = reactive({ person: '', filling: '', bread: '', notes: '', size: 'whole', price: '' })
const firstInput = ref(null)
const saving = ref(false) // peticion en vuelo: evita el doble envio

const canSave = computed(() => draft.filling.trim().length > 0)

/*
 * El foco se pone cuando el campo APARECE, no en un nextTick despues de abrir.
 *
 * Es el mismo truco (y por el mismo motivo) que documenta useInlineEdit: el
 * relevo va con <Transition mode="out-in">, asi que primero tiene que salir la
 * vista normal y el formulario no se monta hasta que esa salida termina. En el
 * nextTick el ref todavia esta vacio y no se enfocaba nada.
 *
 * Dentro de un v-for Vue guarda los refs en un array, de ahi el desenvuelto.
 */
watch(firstInput, (node) => {
  if (!editingId.value) return
  const target = Array.isArray(node) ? node[0] : node
  target?.focus()
})

function num(i) {
  return String(i + 1).padStart(2, '0')
}

// paidAuto === 1: lo marcó el servidor por ser quien puso el dinero ese día.
// Conviene decirlo, o parece que el check se ha movido solo sin motivo.
function paidTitle(o) {
  if (!o.paid) return 'pendiente — pulsa para marcar como pagado'
  if (o.paidAuto === 1) return 'pagado: puso el dinero ese día — pulsa para marcarlo como pendiente'
  return 'pagado — pulsa para marcar como pendiente'
}

function startEdit(o) {
  editingId.value = o.id
  draft.person = o.person
  draft.filling = o.filling
  draft.bread = o.bread
  draft.notes = o.notes
  draft.size = o.size || 'whole'
  draft.price = toInput(o.price)
  // el foco lo pone el watch de firstInput, cuando el campo llegue al DOM
}

function cancel() {
  editingId.value = null
}

/*
 * Guardar y ESPERAR, como hace el formulario de alta.
 *
 * Antes esto cerraba el editor en el mismo tick en que emitia, sin esperar
 * nada: si el PUT fallaba, el aviso salia en una esquina, la fila ya habia
 * vuelto a sus valores viejos y lo que acababas de escribir se perdia. Ahora
 * lo escrito no se toca hasta que el servidor confirma.
 */
async function save(id) {
  if (!canSave.value || saving.value) return
  const { price, ...rest } = draft
  const cents = parse(price)
  saving.value = true
  try {
    await emitUpdate(id, {
      ...rest,
      /*
       * Si la caja del precio se deja en blanco NO se manda el campo, y el
       * servidor conserva el que ya tenia (es un update parcial). Antes iba
       * `parse(price) ?? 0`, asi que vaciar la caja no era "dejalo como esta"
       * sino "ponlo a 0 €", y se cargaba el importe sin avisar.
       */
      ...(cents === null ? {} : { price: cents }),
    })
  } catch {
    return // el aviso ya lo ha dado el composable; los campos se conservan
  } finally {
    saving.value = false
  }
  editingId.value = null
}

// el padre devuelve la promesa de updateOrder, asi sabemos si ha ido bien
function emitUpdate(id, fields) {
  return new Promise((resolve, reject) => {
    emit('update', id, fields, { resolve, reject })
  })
}
</script>

<template>
  <div class="list">
    <!--
      type="transition" no es decoracion: .row declara SIEMPRE
      `animation: row-in var(--dur-4) ... backwards` con su animation-delay (hasta
      12 * --stagger). Al salir, Vue mide la transicion Y la animacion y se queda
      con la mas larga, asi que elegia la ANIMACION (--dur-4 mas doce escalones
      de --stagger: mas de un segundo) en vez de los --dur-2 de .row-leave-active. Luego esperaba un `animationend` que no
      llega nunca —row-in acabo hace rato— y caia en su setTimeout: la fila
      terminaba su fundido a los 200ms y se quedaba 760ms mas en el DOM,
      invisible y en position: absolute, estorbando al -move de las vecinas.

      Con esto Vue solo mira la transicion, que es la que de verdad la saca.
    -->
    <TransitionGroup name="row" type="transition" tag="ul" class="rows">
      <li
        v-for="(o, i) in orders"
        :key="o.id"
        class="row"
        :class="{ fresh: freshIds.has(o.id), mine: isMe(o.person), paid: !!o.paid }"
        :style="{ '--i': Math.min(i, 12) }"
      >
        <span v-if="freshIds.has(o.id)" class="new-badge" aria-hidden="true">NUEVO</span>
        <span class="idx">{{ num(i) }}</span>

        <!--
          El relevo vista normal <-> edicion.

          Antes eran dos <template v-if>/<template v-else> pelados, y eso tiene
          un problema que no se arregla con CSS: un <template> NO es un
          elemento, asi que no hay nada que transicionar. La vista normal
          desaparecia de golpe, la rejilla de la fila saltaba de cuatro columnas
          a dos, y solo entonces entraba el formulario con su fundido. Se veia
          el salto, no el cambio.

          Ahora la fila es SIEMPRE `auto 1fr` —el numero y un hueco— y quien
          cambia es lo que ocupa el hueco: dos cajas de verdad que se relevan
          con `swap`, el mismo vocabulario que los otros cuatro relevos de la
          app. La rejilla de la vista normal se ha mudado a .read, que es quien
          la necesitaba de verdad.

          Con mode="out-in" el alto de la fila cambia mientras el formulario
          todavia esta invisible, que es donde menos se nota.
        -->
        <Transition name="swap" mode="out-in">
          <div v-if="editingId !== o.id" key="read" class="read">
            <div class="body">
              <div class="line-1">
                <span class="person">{{ o.person || 'anónimo' }}</span>
                <span v-if="isMe(o.person)" class="mine-tag">« tú »</span>
                <span class="arrow">::</span>
                <span class="size-chip" :class="o.size === 'half' ? 'half' : 'whole'">
                  {{ o.size === 'half' ? '½' : '1' }}
                </span>
                <span class="filling">{{ o.filling }}</span>
              </div>
              <div class="line-2">
                <span v-if="o.bread" class="tag">pan: {{ o.bread }}</span>
                <span v-if="o.notes" class="tag note">! {{ o.notes }}</span>
                <span v-if="!o.bread && !o.notes" class="tag empty">— sin extras —</span>
              </div>
            </div>

            <div class="pay">
              <span class="amount"><MoneyValue :cents="o.price" /></span>
              <button
                class="paid-btn"
                type="button"
                :class="o.paid ? 'is-paid' : 'is-due'"
                :aria-pressed="!!o.paid"
                :title="paidTitle(o)"
                @click="emit('paid', o.id, !o.paid)"
              >
                <span aria-hidden="true">{{ o.paid ? '✓' : '€' }}</span>
                {{ o.paid ? (o.paidAuto === 1 ? 'puso' : 'pagado') : 'debe' }}
              </button>
            </div>

            <div v-if="!readonly" class="actions">
              <button class="act edit" type="button" :aria-label="`editar pedido de ${o.person}`" @click="startEdit(o)">
                <span aria-hidden="true">✎</span>
              </button>
              <button class="act del" type="button" :aria-label="`eliminar pedido de ${o.person}`" @click="emit('remove', o.id)">
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          </div>

          <!--
            Edicion. Los campos llevan etiqueta y no solo `placeholder`: aqui
            startEdit rellena los seis, asi que el placeholder no se ve NUNCA y
            lo que quedaba eran cuatro cajas identicas con texto dentro sin
            forma de saber cual era el pan y cual las notas. Por lo mismo el `*`
            de obligatorio se ha mudado del placeholder a la etiqueta.

            La caja (.input), la pastilla (.seg) y la etiqueta (.lbl) salen de
            base.css: son las MISMAS que las del formulario de alta, que es de
            donde se habian copiado a mano y de donde ya habian divergido.
          -->
          <form
            v-else
            key="edit"
            class="edit-form"
            @submit.prevent="save(o.id)"
            @keydown.esc="cancel"
          >
            <div class="e-grid">
              <label class="e-field">
                <span class="lbl">// quién pide</span>
                <input
                  ref="firstInput"
                  v-model="draft.person"
                  class="input"
                  type="text"
                  list="bocatones-people-edit"
                  placeholder="nombre"
                  autocomplete="off"
                  maxlength="40"
                />
                <!-- solo existe una fila en edicion a la vez, asi que este id
                     no puede duplicarse con el del formulario de alta -->
                <datalist id="bocatones-people-edit">
                  <option v-for="p in knownPeople" :key="p" :value="p" />
                </datalist>
              </label>

              <label class="e-field">
                <span class="lbl">// relleno *</span>
                <input
                  v-model="draft.filling"
                  class="input"
                  type="text"
                  placeholder="lomo con queso..."
                  autocomplete="off"
                  maxlength="60"
                  :aria-invalid="!canSave"
                />
              </label>

              <label class="e-field">
                <span class="lbl">// pan</span>
                <input
                  v-model="draft.bread"
                  class="input"
                  type="text"
                  placeholder="barra / integral / sin gluten"
                  autocomplete="off"
                  maxlength="40"
                />
              </label>

              <label class="e-field">
                <span class="lbl">// extras / notas</span>
                <input
                  v-model="draft.notes"
                  class="input"
                  type="text"
                  placeholder="sin tomate, con alioli..."
                  autocomplete="off"
                  maxlength="80"
                />
              </label>
            </div>

            <div class="e-row">
              <div class="e-cell">
                <span class="lbl">// tamaño</span>
                <div class="seg" role="group" aria-label="tamaño del bocata">
                  <button
                    type="button"
                    class="seg-btn"
                    :class="{ active: draft.size === 'half' }"
                    :aria-pressed="draft.size === 'half'"
                    @click="draft.size = 'half'"
                  >½ media</button>
                  <button
                    type="button"
                    class="seg-btn"
                    :class="{ active: draft.size === 'whole' }"
                    :aria-pressed="draft.size === 'whole'"
                    @click="draft.size = 'whole'"
                  >🥖 entero</button>
                </div>
              </div>

              <!-- la misma caja de precio que el formulario de alta, y del
                   mismo sitio. Sin roll-in: aquí la cifra llega con el
                   pedido que estás editando, no aparece sola. -->
              <div class="e-cell">
                <span class="lbl">// precio</span>
                <MoneyInput
                  v-model="draft.price"
                  style="--mi-w: 6.5rem"
                  placeholder="0,00"
                  title="en blanco se queda el precio que ya tenía"
                  aria-label="precio en euros"
                />
              </div>
            </div>

            <p v-if="!canSave" class="e-hint" role="alert">
              // el relleno es lo único obligatorio
            </p>

            <div class="e-actions">
              <button class="e-btn save" type="submit" :disabled="!canSave || saving">
                {{ saving ? 'guardando…' : 'guardar' }}
              </button>
              <button class="e-btn cancel" type="button" @click="cancel">cancelar</button>
              <span class="e-esc" aria-hidden="true">esc cancela</span>
            </div>
          </form>
        </Transition>
      </li>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.rows {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  /* relative porque .row-leave-active saca al que se va con position: absolute */
  position: relative;
}

/*
 * Entrada escalonada: las filas van apareciendo de arriba abajo en vez de
 * todas de golpe. El retardo se topa en la 12ª (ver el Math.min del template)
 * para que una lista larga no tarde una eternidad en pintarse.
 *
 * Las filas que llegan por WebSocket llevan .fresh, cuya animación `arrive`
 * sustituye a esta por especificidad: cada caso tiene su entrada.
 */
.row {
  position: relative;
  display: grid;
  animation: row-in var(--dur-4) var(--ease-out) backwards;
  animation-delay: calc(var(--i, 0) * var(--stagger));
  /* el numero y un hueco, y nada mas: lo que cambia al editar es QUIEN ocupa
     el hueco, no la rejilla. Antes la fila saltaba de cuatro columnas a dos en
     el mismo frame en que desaparecia la vista normal. */
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.9rem;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-left: 2px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.75rem 0.9rem;
  transition:
    border-color var(--dur-2) var(--ease-out),
    transform var(--dur-2) var(--ease-out),
    background var(--dur-2) var(--ease-out);
}

/* la rejilla que antes era la de .row: contenido | dinero | acciones */
.read {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 0.9rem;
  min-width: 0;
}

@keyframes row-in {
  from { opacity: 0; transform: translateY(-6px); }
}

/* ---- pedido recién llegado (de otra persona, vía WebSocket) ---- */
.row.fresh {
  animation: arrive 2.6s cubic-bezier(0.2, 0.8, 0.2, 1);
  z-index: var(--z-raised);
}
/* barrido de luz que cruza la fila al llegar */
/* el barrido viaja con transform, no con background-position: antes repintaba
   la fila completa en cada frame, y ocurre una vez por pedido entrante */
.row.fresh::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--radius);
  pointer-events: none;
  overflow: hidden;
}
.row.fresh::after {
  background: linear-gradient(100deg, transparent 38%, var(--glow-soft) 50%, transparent 62%);
  background-size: 100% 100%;
  will-change: transform;
  animation: sweep 0.9s ease-out;
}
@keyframes arrive {
  0% {
    border-left-color: var(--g7);
    box-shadow: 0 0 0 1px var(--g7), 0 0 26px -2px var(--g7);
    transform: translateX(-6px) scale(1.012);
    background: var(--panel);
  }
  18% {
    transform: translateX(0) scale(1);
  }
  70% {
    border-left-color: var(--g7);
    box-shadow: 0 0 0 1px transparent, 0 0 18px -6px var(--g7);
  }
  100% {
    box-shadow: none;
  }
}
@keyframes sweep {
  from { transform: translateX(-100%); }
  to   { transform: translateX(100%); }
}

.new-badge {
  position: absolute;
  top: -8px;
  left: 30px;
  font-size: var(--fs-1);
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--bg);
  background: var(--g7);
  padding: 0.12rem 0.4rem;
  border-radius: 999px;
  box-shadow: 0 0 12px -2px var(--g7);
  animation: badgePop 2.6s ease forwards;
}
@keyframes badgePop {
  0% { transform: scale(0) translateY(4px); opacity: 0; }
  12% { transform: scale(1) translateY(0); opacity: 1; }
  80% { opacity: 1; }
  100% { opacity: 0; transform: scale(0.9); }
}

@media (prefers-reduced-motion: reduce) {
  .row.fresh { animation: none; border-left-color: var(--g7); }
  .row.fresh::after { display: none; }
}
.row:hover:not(:has(.edit-form)) {
  border-left-color: var(--ink);
  background: var(--panel);
  transform: translateX(3px);
}
/*
 * El aspecto de "esta fila se esta editando".
 *
 * Va con :has(.edit-form) y no con una clase .editing atada a `editingId`,
 * que es lo obvio y es lo que habia. El problema de la clase es CUANDO se
 * quita: `editingId = null` la borra en el mismo tick en que empieza la SALIDA
 * del formulario, asi que la fila recuperaba el borde, el fondo y la
 * alineacion normales mientras el formulario todavia se estaba yendo, y el
 * numero pegaba un salto a media altura delante de tus narices. :has aguanta
 * mientras el formulario siga en el DOM, que es exactamente lo que dura la
 * transicion.
 */
.row:has(.edit-form) {
  /* el numero se sube a la primera linea del formulario: centrado en una caja
     de seis controles se quedaba flotando a media altura, sin nada al lado */
  align-items: start;
  border-left-color: var(--g7);
  background: var(--panel);
}

.idx {
  font-family: var(--crt);
  font-size: var(--fs-5);
  line-height: 1;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}
.row:hover .idx { color: var(--ink-dim); }

.body { min-width: 0; }

.line-1 {
  display: flex;
  align-items: baseline;
  gap: 0.6ch;
  flex-wrap: wrap;
}
.person { font-weight: 700; color: var(--ink); }

/* tu propio pedido, en una lista compartida */
.row.mine { border-left-color: var(--ink); background: var(--panel); }
.mine-tag {
  font-size: var(--fs-1);
  letter-spacing: 0.06em;
  color: var(--ink-dim);
  white-space: nowrap;
}
.arrow { color: var(--ink-faint); }
.filling { color: var(--ink); word-break: break-word; }

.size-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.25rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  font-size: var(--fs-2);
  font-weight: 700;
  line-height: 1;
  border: 1px solid var(--line-2);
}
.size-chip.whole { color: var(--bg); background: var(--ink); border-color: var(--ink); }
.size-chip.half { color: var(--ink); background: transparent; border-style: dashed; border-color: var(--ink-dim); }


.line-2 {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.7rem;
  margin-top: 0.3rem;
  font-size: var(--fs-2);
}
.tag { color: var(--ink-dim); }
.tag.note { color: var(--ink); }
.tag.empty { color: var(--ink-faint); font-style: italic; }

/* ---- dinero: importe + estado de pago ---- */
.pay {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.amount {
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-3);
  color: var(--ink-dim);
  white-space: nowrap;
  transition: opacity var(--dur-3) var(--ease-out);
}

/*
 * Pagado = el dinero se calla.
 *
 * El paso `debe -> pagado` era instantaneo: el boton cambiaba de color (ya
 * tenia su transition) y el importe se quedaba igual de encendido que el de
 * quien todavia debe. Asi no se distinguia de un vistazo lo que falta por
 * cobrar, que es justo para lo que se mira la lista.
 *
 * Se apaga el importe y NO se tacha: `line-through` cambia la caja y no se
 * puede animar con transform, que es la regla de la casa (base.css:334).
 *
 * Y NO se toca el borde izquierdo a proposito: ahi ya se pelean tres senales
 * (.fresh, la edicion y .mine). Una cuarta seria ruido, no informacion.
 */
.row.paid .amount { opacity: 0.45; }
.paid-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap);
  gap: 0.4ch;
  font-family: var(--mono);
  font-size: var(--fs-1);
  letter-spacing: 0.04em;
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 0.22rem 0.6rem;
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out),
    box-shadow var(--dur-1) var(--ease-out);
}
.paid-btn.is-due { color: var(--g6); border-color: color-mix(in srgb, var(--g6) 45%, var(--line-2)); }
.paid-btn.is-due:hover { border-color: var(--g6); box-shadow: 0 0 14px -6px var(--g6); }
.paid-btn.is-paid { color: var(--g5); border-color: color-mix(in srgb, var(--g5) 45%, var(--line-2)); }
.paid-btn.is-paid:hover { border-color: var(--g5); box-shadow: 0 0 14px -6px var(--g5); }

@media (max-width: 560px) {
  .read { grid-template-columns: 1fr auto; }
  .pay { grid-column: 1 / -1; margin-top: 0.35rem; }
}

.actions { display: flex; gap: 0.35rem; }
.act {
  background: transparent;
  border: 1px solid transparent;
  color: var(--ink-faint);
  font-size: var(--fs-3);
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius);
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    background var(--dur-1) var(--ease-out);
}
.act.edit:hover { color: var(--bg); background: var(--g7); }
.act.del:hover { color: var(--bg); background: var(--ink); }

/* ---- edición ----
   La caja (.input), la pastilla (.seg) y la etiqueta (.lbl) son las de
   base.css, compartidas con el formulario de alta. Aquí solo queda la
   disposición. */
.edit-form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 0;
  /* la fila ya trae su propio padding, pero el formulario necesita respirar
     un poco más que la vista normal: son seis controles, no una línea de texto */
  padding-block: 0.2rem;
}
.e-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-2) var(--sp-3);
}
@media (max-width: 560px) { .e-grid { grid-template-columns: 1fr; } }

/* mismo par etiqueta+campo que .field en el formulario de alta */
.e-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}

.e-row {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: var(--sp-2) var(--sp-4);
}
/* tamaño y precio, cada uno bajo su etiqueta, igual que los campos de arriba */
.e-cell { display: flex; flex-direction: column; gap: 0.4rem; }

/* por qué está apagado «guardar», en vez de un botón muerto sin explicación */
.e-hint {
  font-size: var(--fs-1);
  color: var(--g6);
  letter-spacing: 0.04em;
}

.e-actions { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
/* la salida de teclado, dicha en voz baja. aria-hidden en el template: para
   quien va con lector de pantalla la tecla no es una pista visual */
.e-esc {
  margin-left: auto;
  font-size: var(--fs-1);
  color: var(--ink-faint);
  letter-spacing: 0.06em;
}
.e-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap);
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 700;
  letter-spacing: 0.04em;
  border-radius: var(--radius);
  padding: 0.45rem 1rem;
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    background var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}
.e-btn.save {
  color: var(--bg);
  background: var(--ink);
  border: 1px solid var(--ink);
}
.e-btn.save:disabled { color: var(--ink-faint); background: transparent; border-color: var(--line-2); cursor: not-allowed; }
.e-btn.cancel {
  color: var(--ink-dim);
  background: transparent;
  border: 1px solid var(--line-2);
}
.e-btn.cancel:hover { color: var(--ink); border-color: var(--ink); }

/* TransitionGroup — `all` incluía height/margin/padding, así que cada alta o
   baja provocaba un reflow de la lista entera; los -from/-to solo usan
   opacity y transform, con lo que `all` no aportaba nada */
.row-enter-active { transition: opacity var(--dur-3) var(--ease-out), transform var(--dur-3) var(--ease-out); }
/* absolute y no relative: el que se va tiene que salir del flujo o los que
   quedan no pueden deslizarse a su sitio con -move, que es justo el tiron seco
   que -move existe para evitar. OJO: eso obliga a listarlo en el bloque de
   movimiento reducido de base.css, con los demas -leave-active absolutos. */
.row-leave-active { transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out); position: absolute; }
.row-enter-from { opacity: 0; transform: translateX(-14px); border-left-color: var(--g5); }
.row-leave-to { opacity: 0; transform: translateX(40px); }
/* faltaba: reordenar la cola no estaba animado */
.row-move { transition: transform var(--dur-3) var(--ease-out); }
</style>