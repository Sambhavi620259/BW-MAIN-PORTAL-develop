export const USE_MOCK_API =
  import.meta.env.PROD ? false : import.meta.env.VITE_USE_MOCK_API === "true";

if (import.meta.env.DEV) {
  // Print once per app startup (helps catch accidental mock mode).
  if (!globalThis.__bwMockApiModeLogged) {
    globalThis.__bwMockApiModeLogged = true;
    // eslint-disable-next-line no-console
    console.info("[MOCK API MODE]", USE_MOCK_API);
  }
}

export function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function safeServiceCall({ request, fallback }) {
  if (USE_MOCK_API) {
    return cloneDeep(fallback);
  }
  return request();
}
