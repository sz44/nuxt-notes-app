// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      script: [
        {
          innerHTML: "try{var theme=localStorage.getItem('notes-theme');if(theme!=='light'){document.documentElement.classList.add('theme-dark')}}catch(e){document.documentElement.classList.add('theme-dark')}"
        }
      ]
    }
  },
  runtimeConfig: {
    tursoDatabaseUrl: process.env.TURSO_DATABASE_URL || 'file:notes.db',
    tursoAuthToken: process.env.TURSO_AUTH_TOKEN || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    public: {
      googleClientId: process.env.GOOGLE_CLIENT_ID || ''
    }
  }
})
