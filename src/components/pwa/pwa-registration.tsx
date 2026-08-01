import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const baseUrl = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    void navigator.serviceWorker.register(`${baseUrl}service-worker.js`, { scope: baseUrl }).catch((error: unknown) => {
      // Registration failure should remain observable without preventing ERP use.
      console.warn("HALAL Field hors connexion indisponible.", error);
    });
  }, []);

  return null;
}
