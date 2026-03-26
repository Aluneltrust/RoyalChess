/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string;
  readonly VITE_BSV_NETWORK: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}