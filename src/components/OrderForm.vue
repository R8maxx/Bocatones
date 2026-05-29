<script setup>
import { ref, computed } from 'vue'
import { useClassics } from '../composables/useClassics.js'

const emit = defineEmits(['add'])
const { classics, addClassic, removeClassic } = useClassics()

const person = ref('')
const filling = ref('')
const bread = ref('')
const notes = ref('')

const valid = computed(() => person.value.trim() && filling.value.trim())

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

function submit() {
  if (!valid.value) return
  emit('add', {
    person: person.value,
    filling: filling.value,
    bread: bread.value,
    notes: notes.value,
  })
  person.value = ''
  filling.value = ''
  bread.value = ''
  notes.value = ''
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
        <input v-model="person" type="text" placeholder="tu nombre" autocomplete="off" maxlength="40" />
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

    <div class="quick">
      <span class="quick-lbl">clásicos:</span>
      <span v-for="c in classics" :key="c.id" class="chip">
        <button type="button" class="chip-pick" @click="pick(c.name)">{{ c.name }}</button>
        <button type="button" class="chip-del" :aria-label="`borrar clásico ${c.name}`" @click="removeClassic(c.id)">✕</button>
      </span>

      <button
        v-if="canSaveClassic"
        type="button"
        class="chip add"
        @click="saveAsClassic"
      >+ guardar «{{ filling.trim() }}»</button>
    </div>

    <button class="submit" type="submit" :disabled="!valid">
      <span class="caret">►</span> añadir al pedido
    </button>
  </form>
</template>

<style scoped>
.form {
  background: var(--panel);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: clamp(1rem, 2.5vw, 1.6rem);
  box-shadow: 0 0 0 1px #000, 0 18px 40px -28px #000;
}

.form-head {
  display: flex;
  gap: 0.6ch;
  flex-wrap: wrap;
  font-size: 0.82rem;
  margin-bottom: 1.2rem;
  padding-bottom: 0.9rem;
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
  grid-template-columns: repeat(2, 1fr);
  gap: 0.9rem 1.2rem;
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
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  color: var(--ink-faint);
  text-transform: uppercase;
}

input {
  font-family: var(--mono);
  font-size: 0.95rem;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--line-2);
  border-radius: var(--radius);
  padding: 0.7rem 0.8rem;
  transition: border-color 0.2s, box-shadow 0.2s;
}
input::placeholder { color: var(--ink-faint); }
input:focus {
  border-color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--ink);
  outline: none;
}

.quick {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1.1rem 0 1.3rem;
}
.quick-lbl {
  font-size: 0.72rem;
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
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--ink-dim);
  background: transparent;
  border: none;
  padding: 0.28rem 0.2rem 0.28rem 0.7rem;
  cursor: pointer;
  transition: color 0.15s;
}
.chip-pick:hover { color: var(--ink); }
.chip-del {
  font-size: 0.6rem;
  color: var(--ink-faint);
  background: transparent;
  border: none;
  padding: 0 0.55rem 0 0.35rem;
  cursor: pointer;
  transition: color 0.15s;
}
.chip-del:hover { color: var(--g1); }

.chip.add {
  border-style: dashed;
  border-color: var(--ink-dim);
  font-family: var(--mono);
  font-size: 0.78rem;
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
  font-size: 0.95rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--bg);
  background: var(--ink);
  border: 1px solid var(--ink);
  border-radius: var(--radius);
  padding: 0.85rem;
  cursor: pointer;
  transition: transform 0.1s, background 0.2s, color 0.2s, box-shadow 0.2s;
}
.submit .caret { display: inline-block; transform: translateY(1px); }
.submit:hover:not(:disabled) {
  box-shadow: 0 0 26px -4px rgba(255, 255, 255, 0.45);
}
.submit:active:not(:disabled) { transform: translateY(1px) scale(0.997); }
.submit:disabled {
  color: var(--ink-faint);
  background: transparent;
  border-color: var(--line-2);
  cursor: not-allowed;
}
</style>