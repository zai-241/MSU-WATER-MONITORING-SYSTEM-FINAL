/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FCM_VAPID_KEY?: string;
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
