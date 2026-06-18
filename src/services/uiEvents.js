const MY_APPS_CHANGED_EVENT = "ui:my-apps-changed";
const APPS_CATALOG_CHANGED_EVENT = "ui:apps-catalog-changed";

export function emitMyAppsChanged() {
  window.dispatchEvent(new CustomEvent(MY_APPS_CHANGED_EVENT));
}

export function onMyAppsChanged(handler) {
  window.addEventListener(MY_APPS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(MY_APPS_CHANGED_EVENT, handler);
}

/** Fired after admin (or server) mutates the public app catalog so list pages can refetch without full reload. */
export function emitAppsCatalogChanged() {
  window.dispatchEvent(new CustomEvent(APPS_CATALOG_CHANGED_EVENT));
}

export function onAppsCatalogChanged(handler) {
  window.addEventListener(APPS_CATALOG_CHANGED_EVENT, handler);
  return () => window.removeEventListener(APPS_CATALOG_CHANGED_EVENT, handler);
}

