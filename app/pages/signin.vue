<script setup lang="ts">
const config = useRuntimeConfig()
const errorMessage = ref('')
const buttonEl = ref<HTMLElement | null>(null)

const { data } = await useFetch<{ user: { id: string, email: string } }>('/api/me')
if (data.value?.user) {
  await navigateTo('/')
}

onMounted(async () => {
  if (!config.public.googleClientId) {
    errorMessage.value = 'GOOGLE_CLIENT_ID is not configured.'
    return
  }

  await loadGoogleIdentityScript()

  window.google.accounts.id.initialize({
    client_id: config.public.googleClientId,
    callback: handleCredential
  })

  if (buttonEl.value) {
    window.google.accounts.id.renderButton(buttonEl.value, {
      theme: 'outline',
      size: 'large',
      type: 'standard',
      shape: 'rectangular',
      text: 'signin_with',
      width: 320
    })
  }
})

async function handleCredential(response: { credential?: string }) {
  errorMessage.value = ''

  try {
    await $fetch('/api/auth/google', {
      method: 'POST',
      body: { credential: response.credential }
    })
    await navigateTo('/')
  } catch {
    errorMessage.value = 'Could not sign in with Google.'
  }
}

function loadGoogleIdentityScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(script)
  })
}

declare global {
  interface Window {
    google: {
      accounts: {
        id: {
          initialize: (options: { client_id: string, callback: (response: { credential?: string }) => void }) => void
          renderButton: (element: HTMLElement, options: Record<string, string | number>) => void
        }
      }
    }
  }
}
</script>

<template>
  <main class="signin-page">
    <section class="signin-panel">
      <div class="brand-mark">Notes</div>
      <h1>Sign in to your notes</h1>
      <p>Use your Google account to create and search private notes.</p>
      <div ref="buttonEl" class="google-button" />
      <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
    </section>
  </main>
</template>
