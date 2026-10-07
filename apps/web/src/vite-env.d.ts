/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_GOOGLE_REDIRECT_URI?: string
  readonly VITE_BASE_PATH?: string
  // "true" shows the local-only Dev login (dev server only, never in builds).
  readonly VITE_DEV_LOGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
