// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    tursoDatabaseUrl: process.env.TURSO_DATABASE_URL || 'file:notes.db',
    tursoAuthToken: process.env.TURSO_AUTH_TOKEN || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    enableNativeFts: process.env.TURSO_ENABLE_NATIVE_FTS === 'true',
    public: {
      googleClientId: process.env.GOOGLE_CLIENT_ID || ''
    }
  }
})
