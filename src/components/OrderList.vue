<script setup>
import { ref, reactive, nextTick } from 'vue'
import { fmt, toInput, parse } from '../money.js'
import { useMe } from '../composables/useMe.js'

defineProps({
  orders: { type: Array, required: true },
  freshIds: { type: Object, default: () => new Set() },
  readonly: { type: Boolean, default: false }, // en el histórico solo se toca el pago
})
const emit = defineEmits(['remove', 'update', 'paid'])

const { isMe } = useMe()

const editingId = ref(null)
const draft = reactive({ person: '', filling: '', bread: '', notes: '', size: 'whole', price: '' })
const firstInput = ref(null)

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

async function startEdit(o) {
  editingId.value = o.id
  draft.person = o.person
  draft.filling = o.filling
  draft.bread = o.bread
  draft.notes = o.notes
  draft.size = o.size || 'whole'
  draft.price = toInput(o.price)
  await nextTick()
  firstInput.value?.[0]?.focus()
}

function cancel() {
  editingId.value = null
}

function save(id) {
  if (!draft.filling.trim()) return // el relleno es obligatorio
  const { price, ...rest } = draft
  emit('update', id, { ...rest, price: parse(price) ?? 0 })
  editingId.value = null
}
</script>

<template>
  <div class="list">
    <TransitionGroup name="row" tag="ul" class="rows">
      <li
        v-for="(o, i) in orders"
        :key="o.id"
        class="row"
        :class="{ editing: editingId === o.id, fresh: freshIds.has(o.id), mine: isMe(o.person) }"
        :style="{ '--i': Math.min(i, 12) }"
      >
        <span v-if="freshIds.has(o.id)" class="new-badge" aria-hidden="true">NUEVO</span>
        <span class="idx">{{ num(i) }}</span>

        <!-- vista normal -->
        <template v-if="editingId !== o.id">
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
            <span class="amount">{{ fmt(o.price) }}</span>
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
        </template>

        <!--
          Modo edición. La transición envuelve SÓLO al formulario, que en
          .row.editing es el segundo hijo del grid: meter un div de envoltorio
          alrededor de cada rama rompería las dos rejillas (auto 1fr auto auto
          en la vista normal, auto 1fr aquí). Con `appear` el formulario entra
          animado en vez de aparecer de golpe.
        -->
        <template v-else>
          <Transition name="swap" appear>
          <form class="edit-form" @submit.prevent="save(o.id)">
            <div class="e-grid">
              <input ref="firstInput" v-model="draft.person" placeholder="nombre" maxlength="40" />
              <input v-model="draft.filling" placeholder="relleno *" maxlength="60" />
              <input v-model="draft.bread" placeholder="pan" maxlength="40" />
              <input v-model="draft.notes" placeholder="extras / notas" maxlength="80" />
            </div>
            <div class="e-row">
              <div class="e-seg" role="group" aria-label="tamaño">
                <button type="button" class="e-seg-btn" :class="{ active: draft.size === 'half' }" @click="draft.size = 'half'">½ media</button>
                <button type="button" class="e-seg-btn" :class="{ active: draft.size === 'whole' }" @click="draft.size = 'whole'">🥖 entero</button>
              </div>
              <span class="e-price">
                <input v-model="draft.price" type="text" inputmode="decimal" maxlength="7" placeholder="0,00" aria-label="precio en euros" />
                <span class="e-cur" aria-hidden="true">€</span>
              </span>
            </div>
            <div class="e-actions">
              <button class="e-btn save" type="submit" :disabled="!draft.filling.trim()">guardar</button>
              <button class="e-btn cancel" type="button" @click="cancel">cancelar</button>
            </div>
          </form>
          </Transition>
        </template>
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
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.9rem;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-left: 2px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.75rem 0.9rem;
  transition: border-color 0.2s, transform 0.2s, background 0.2s;
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
.row:hover:not(.editing) {
  border-left-color: var(--ink);
  background: var(--panel);
  transform: translateX(3px);
}
.row.editing {
  grid-template-columns: auto 1fr;
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

/* fila de tamaño + precio en el modo edición */
.e-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.6rem 0.9rem; }
.e-price { position: relative; display: inline-flex; align-items: center; }
.e-price input {
  width: 6rem;
  min-width: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 0.26rem 1.5rem 0.26rem 0.7rem;
}
.e-price input:focus { border-color: var(--ink); }
.e-cur { position: absolute; right: 0.65rem; font-size: var(--fs-2); color: var(--ink-faint); pointer-events: none; }

.e-seg {
  display: inline-flex;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 2px;
  gap: 2px;
  align-self: flex-start;
}
.e-seg-btn {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink-dim);
  background: transparent;
  border: none;
  border-radius: 999px;
  padding: 0.28rem 0.75rem;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.e-seg-btn:hover { color: var(--ink); }
.e-seg-btn.active { color: var(--bg); background: var(--ink); font-weight: 700; }

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
}
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
  transition: color 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.paid-btn.is-due { color: var(--g6); border-color: color-mix(in srgb, var(--g6) 45%, var(--line-2)); }
.paid-btn.is-due:hover { border-color: var(--g6); box-shadow: 0 0 14px -6px var(--g6); }
.paid-btn.is-paid { color: var(--g5); border-color: color-mix(in srgb, var(--g5) 45%, var(--line-2)); }
.paid-btn.is-paid:hover { border-color: var(--g5); box-shadow: 0 0 14px -6px var(--g5); }

@media (max-width: 560px) {
  .row { grid-template-columns: auto 1fr auto; }
  .pay { grid-column: 2 / -1; margin-top: 0.35rem; }
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
  transition: color 0.15s, background 0.15s;
}
.act.edit:hover { color: var(--bg); background: var(--g7); }
.act.del:hover { color: var(--bg); background: var(--ink); }

/* ---- edición ---- */
.edit-form { display: flex; flex-direction: column; gap: 0.7rem; }
.e-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}
@media (max-width: 560px) { .e-grid { grid-template-columns: 1fr; } }
.e-grid input {
  min-width: 0; /* mismo motivo que en OrderForm: mínimo intrínseco del input */
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.55rem 0.7rem;
}
.e-grid input::placeholder { color: var(--ink-faint); }
.e-grid input:focus { border-color: var(--ink); }

.e-actions { display: flex; gap: 0.5rem; }
.e-btn {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 700;
  letter-spacing: 0.04em;
  border-radius: var(--radius);
  padding: 0.45rem 1rem;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
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
.row-enter-active { transition: opacity 0.32s, transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1); }
.row-leave-active { transition: opacity 0.28s ease, transform 0.28s ease; position: relative; }
.row-enter-from { opacity: 0; transform: translateX(-14px); border-left-color: var(--g5); }
.row-leave-to { opacity: 0; transform: translateX(40px); }
</style>