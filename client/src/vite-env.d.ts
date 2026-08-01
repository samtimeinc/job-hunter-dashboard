/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional shared secret for the in-app "Refresh now" button. */
  readonly VITE_SCAN_SECRET?: string;
  /** Override the dev API base URL. Defaults to http://localhost:3001. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
