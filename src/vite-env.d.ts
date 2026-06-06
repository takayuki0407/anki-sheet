/// <reference types="vite/client" />

// Stamped at build time (see vite.config.ts) so the running bundle can be identified
// from the UI — lets us tell whether a device is on the latest deploy or a stale SW cache.
declare const __BUILD_ID__: string;
