<script setup>
import { ref, reactive, nextTick } from 'vue'

defineProps({
  orders: { type: Array, required: true },
  freshIds: { type: Object, default: () => new Set() },
})
const emit = defineEmits(['remove', 'update'])

const editingId = ref(null)
const draft = reactive({ person: '', filling: '', bread: '', notes: '' })
const firstInput = ref(null)

function num(i) {
  return String(i + 1).padStart(2, '0')
}

async function startEdit(o) {
  editingId.value = o.id
  draft.person = o.person
  draft.filling = o.filling
  draft.bread = o.bread
  draft.notes = o.notes
  await nextTick()
  firstInput.value?.[0]?.focus()
}

function cancel() {
  editingId.value = null
}

function save(id) {
  if (!draft.filling.trim()) return // el relleno es obligatorio
  emit('update', id, { ...draft })
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
        :class="{ editing: editingId === o.id, fresh: freshIds.has(o.id) }"
      >
        <span v-if="freshIds.has(o.id)" class="new-badge" aria-hidden="true">NUEVO</span>
        <span class="idx">{{ num(i) }}</span>

        <!-- vista normal -->
        <template v-if="editingId !== o.id">
          <div class="body">
            <div class="line-1">
              <span class="person">{{ o.person || 'anónimo' }}</span>
              <span class="arrow">::</span>
              <span class="filling">{{ o.filling }}</span>
            </div>
            <div class="line-2">
              <span v-if="o.bread" class="tag">pan: {{ o.bread }}</span>
              <span v-if="o.notes" class="tag note">! {{ o.notes }}</span>
              <span v-if="!o.bread && !o.notes" class="tag empty">— sin extras —</span>
            </div>
          </div>

          <div class="actions">
            <button class="act edit" type="button" :aria-label="`editar pedido de ${o.person}`" @click="startEdit(o)">
              <span aria-hidden="true">✎</span>
            </button>
            <button class="act del" type="button" :aria-label="`eliminar pedido de ${o.person}`" @click="emit('remove', o.id)">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </template>

        <!-- modo edición -->
        <template v-else>
          <form class="edit-form" @submit.prevent="save(o.id)">
            <div class="e-grid">
              <input ref="firstInput" v-model="draft.person" placeholder="nombre" maxlength="40" />
              <input v-model="draft.filling" placeholder="relleno *" maxlength="60" />
              <input v-model="draft.bread" placeholder="pan" maxlength="40" />
              <input v-model="draft.notes" placeholder="extras / notas" maxlength="80" />
            </div>
            <div class="e-actions">
              <button class="e-btn save" type="submit" :disabled="!draft.filling.trim()">guardar</button>
              <button class="e-btn cancel" type="button" @click="cancel">cancelar</button>
            </div>
          </form>
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

.row {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.9rem;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-left: 2px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.75rem 0.9rem;
  transition: border-color 0.2s, transform 0.2s, background 0.2s;
}

/* ---- pedido recién llegado (de otra persona, vía WebSocket) ---- */
.row.fresh {
  animation: arrive 2.6s cubic-bezier(0.2, 0.8, 0.2, 1);
  z-index: 1;
}
/* barrido de luz que cruza la fila al llegar */
.row.fresh::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--radius);
  pointer-events: none;
  background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.16) 50%, transparent 70%);
  background-size: 220% 100%;
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
  from { background-position: 180% 0; }
  to   { background-position: -80% 0; }
}

.new-badge {
  position: absolute;
  top: -8px;
  left: 30px;
  font-size: 0.58rem;
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
  font-size: 1.6rem;
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
.arrow { color: var(--ink-faint); }
.filling { color: var(--ink); word-break: break-word; }

.line-2 {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.7rem;
  margin-top: 0.3rem;
  font-size: 0.78rem;
}
.tag { color: var(--ink-dim); }
.tag.note { color: var(--ink); }
.tag.empty { color: var(--ink-faint); font-style: italic; }

.actions { display: flex; gap: 0.35rem; }
.act {
  background: transparent;
  border: 1px solid transparent;
  color: var(--ink-faint);
  font-size: 0.85rem;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.15s;
}
.act.edit:hover { color: var(--bg); background: var(--g7); }
.act.del:hover { color: var(--bg); background: var(--ink); }

/* ---- edición ---- */
.edit-form { display: flex; flex-direction: column; gap: 0.7rem; }
.e-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}
@media (max-width: 560px) { .e-grid { grid-template-columns: 1fr; } }
.e-grid input {
  font-family: var(--mono);
  font-size: 0.9rem;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.55rem 0.7rem;
}
.e-grid input::placeholder { color: var(--ink-faint); }
.e-grid input:focus { border-color: var(--ink); outline: none; }

.e-actions { display: flex; gap: 0.5rem; }
.e-btn {
  font-family: var(--mono);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  border-radius: var(--radius);
  padding: 0.45rem 1rem;
  cursor: pointer;
  transition: all 0.15s;
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

/* TransitionGroup */
.row-enter-active { transition: all 0.32s cubic-bezier(0.2, 0.8, 0.2, 1); }
.row-leave-active { transition: all 0.28s ease; position: relative; }
.row-enter-from { opacity: 0; transform: translateX(-14px); border-left-color: var(--g5); }
.row-leave-to { opacity: 0; transform: translateX(40px); }
</style>