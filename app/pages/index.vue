<script setup lang="ts">
type User = {
  id: string
  email: string
}

type Note = {
  id: string
  body: string
  createdAt: number
  updatedAt: number
  highlightedBody: string | null
  searchRelevance: number | null
}

const user = ref<User | null>(null)
const notes = ref<Note[]>([])
const search = ref('')
const draft = ref('')
const composerExpanded = ref(false)
const composerTextarea = ref<HTMLTextAreaElement | null>(null)
const openMenu = ref(false)
const openNoteMenu = ref<string | null>(null)
const expandedNotes = ref<Set<string>>(new Set())
const theme = ref<'light' | 'dark'>('dark')
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const editing = reactive<Record<string, string>>({})
const editTimers = new Map<string, ReturnType<typeof setTimeout>>()
const requestFetch = useRequestFetch()

const meResponse = await useFetch<{ user: User }>('/api/me')
if (meResponse.error.value) {
  await navigateTo('/signin')
} else if (meResponse.data.value?.user) {
  user.value = meResponse.data.value.user
  await loadNotes()
}

loading.value = false

watch(search, () => {
  loadNotes()
})

onMounted(() => {
  const savedTheme = window.localStorage.getItem('notes-theme')
  if (savedTheme === 'light' || savedTheme === 'dark') {
    theme.value = savedTheme
  }
  applyThemeClass(theme.value)
  document.addEventListener('pointerdown', closeExpandedNotesOnClickAway)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeExpandedNotesOnClickAway)
})

watch(theme, (nextTheme) => {
  if (import.meta.client) {
    window.localStorage.setItem('notes-theme', nextTheme)
    applyThemeClass(nextTheme)
  }
})

async function loadNotes() {
  if (!user.value) {
    return
  }

  const response = await requestFetch<{ notes: Note[] }>('/api/notes', {
    query: search.value ? { q: search.value } : undefined
  })
  notes.value = response.notes
  for (const note of response.notes) {
    editing[note.id] = note.body
  }
}

async function createNote() {
  const body = draft.value.trim()
  if (!body || saving.value) {
    return
  }

  saving.value = true
  errorMessage.value = ''

  try {
    await $fetch('/api/notes', {
      method: 'POST',
      body: { body }
    })
    draft.value = ''
    composerExpanded.value = false
    search.value = ''
    await loadNotes()
  } catch {
    errorMessage.value = 'Could not save this note.'
  } finally {
    saving.value = false
  }
}

async function expandComposer() {
  composerExpanded.value = true
  await nextTick()
  composerTextarea.value?.focus()
}

function closeComposer() {
  composerExpanded.value = false
}

function queueUpdate(note: Note) {
  if (editTimers.has(note.id)) {
    clearTimeout(editTimers.get(note.id))
  }

  editTimers.set(note.id, setTimeout(() => {
    editTimers.delete(note.id)
    updateNote(note)
  }, 650))
}

async function updateNote(note: Note, restoreEmpty = false) {
  if (editTimers.has(note.id)) {
    clearTimeout(editTimers.get(note.id))
    editTimers.delete(note.id)
  }

  const body = editing[note.id]?.trim() || ''
  if (!body) {
    if (restoreEmpty) {
      editing[note.id] = note.body
    }
    return
  }

  if (body === note.body) {
    return
  }

  const savedBody = body

  try {
    const response = await $fetch<{ note: { body: string, updatedAt: number } }>(`/api/notes/${note.id}`, {
      method: 'PATCH',
      body: { body: savedBody }
    })

    if ((editing[note.id]?.trim() || '') === savedBody) {
      note.body = response.note.body
      note.updatedAt = response.note.updatedAt
    }
  } catch {
    errorMessage.value = 'Could not update this note.'
    editing[note.id] = note.body
  }
}

async function expandNote(note: Note) {
  expandedNotes.value = new Set(expandedNotes.value).add(note.id)
  await nextTick()
  document.querySelector<HTMLTextAreaElement>(`[data-note-editor="${note.id}"]`)?.focus()
}

function closeExpandedNotesOnClickAway(event: PointerEvent) {
  const target = event.target as Element | null

  if (composerExpanded.value && !target?.closest('.composer')) {
    closeComposer()
  }

  if (expandedNotes.value.size === 0) {
    return
  }

  const noteCard = target?.closest<HTMLElement>('[data-note-card]')
  if (noteCard?.dataset.noteCard && expandedNotes.value.has(noteCard.dataset.noteCard)) {
    return
  }

  for (const note of notes.value) {
    if (expandedNotes.value.has(note.id)) {
      updateNote(note, true)
    }
  }

  expandedNotes.value = new Set()
}

async function deleteNote(note: Note) {
  if (editTimers.has(note.id)) {
    clearTimeout(editTimers.get(note.id))
    editTimers.delete(note.id)
  }

  openNoteMenu.value = null
  const nextExpandedNotes = new Set(expandedNotes.value)
  nextExpandedNotes.delete(note.id)
  expandedNotes.value = nextExpandedNotes
  await $fetch(`/api/notes/${note.id}`, { method: 'DELETE' })
  notes.value = notes.value.filter((item) => item.id !== note.id)
}

async function signOut() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/signin')
}

function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
}

function applyThemeClass(nextTheme: 'light' | 'dark') {
  document.documentElement.classList.toggle('theme-dark', nextTheme === 'dark')
  document.documentElement.classList.toggle('theme-light', nextTheme === 'light')
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp * 1000))
}
</script>

<template>
  <main class="app-page" :class="`theme-${theme}`">
    <header class="topbar">
      <div class="topbar-inner">
        <NuxtLink class="logo" to="/">Notes</NuxtLink>
        <label class="search-wrap" aria-label="Search notes">
          <span class="search-icon">

            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32">
              <path d="M0 0h32v32H0z" fill="none" />
              <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                <circle cx="14" cy="14" r="12" />
                <path d="m23 23l7 7" />
              </g>
            </svg>
          </span>

          <input v-model="search" type="search" placeholder="Search" autocomplete="off">
        </label>
        <div class="topbar-actions">
          <button
            class="theme-toggle"
            type="button"
            :aria-label="theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'"
            @click="toggleTheme"
          >
            {{ theme === 'light' ? '☾' : '☀' }}
          </button>
          <div class="account">
            <button class="account-button" type="button" @click="openMenu = !openMenu">
              {{ user?.email.slice(0, 1).toUpperCase() }}
            </button>
            <div v-if="openMenu" class="account-menu">
              <p>{{ user?.email }}</p>
              <button type="button" @click="signOut">Sign out</button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section v-if="!loading" class="notes-shell">
      <form class="composer" :class="{ 'is-expanded': composerExpanded }" @submit.prevent="createNote">
        <input
          v-if="!composerExpanded"
          v-model="draft"
          type="text"
          placeholder="Take a note..."
          autocomplete="off"
          @focus="expandComposer"
          @click="expandComposer"
        >
        <textarea
          v-else
          ref="composerTextarea"
          v-model="draft"
          placeholder="Take a note..."
          rows="3"
          @keydown.meta.enter.prevent="createNote"
          @keydown.ctrl.enter.prevent="createNote"
        />
        <div v-if="composerExpanded" class="composer-actions">
          <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
          <div class="composer-buttons">
            <button type="submit" :disabled="!draft.trim() || saving">
              {{ saving ? 'Saving' : 'Done' }}
            </button>
          </div>
        </div>
      </form>

      <div class="notes-list" aria-live="polite">
        <article v-for="note in notes" :key="note.id" class="note-row" :data-note-card="note.id">
          <textarea
            v-if="expandedNotes.has(note.id)"
            v-model="editing[note.id]"
            rows="10"
            aria-label="Note body"
            :data-note-editor="note.id"
            @input="queueUpdate(note)"
            @blur="updateNote(note, true)"
          />
          <div
            v-else
            class="note-preview"
            role="button"
            tabindex="0"
            aria-label="Open note for editing"
            @click="expandNote(note)"
            @keydown.enter.prevent="expandNote(note)"
            @keydown.space.prevent="expandNote(note)"
          >
            {{ note.body }}
          </div>
          <div v-if="search && note.highlightedBody" class="highlight" v-html="note.highlightedBody" />
          <footer v-if="expandedNotes.has(note.id)">
            <span>Updated {{ formatDate(note.updatedAt) }}</span>
            <div class="note-row-actions">
              <div class="note-menu">
                <button
                  class="note-menu-button"
                  type="button"
                  aria-label="Note settings"
                  aria-haspopup="menu"
                  :aria-expanded="openNoteMenu === note.id"
                  @click="openNoteMenu = openNoteMenu === note.id ? null : note.id"
                >
                  ⋮
                </button>
                <div v-if="openNoteMenu === note.id" class="note-menu-panel" role="menu">
                  <button type="button" role="menuitem" @click="deleteNote(note)">Delete note</button>
                </div>
              </div>
            </div>
          </footer>
        </article>
      </div>

      <p v-if="notes.length === 0" class="empty-state">
        {{ search ? 'No matching notes.' : 'No notes yet.' }}
      </p>
    </section>
  </main>
</template>
