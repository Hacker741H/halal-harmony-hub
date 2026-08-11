import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cachePosOfflineCatalogue,
  getPosOfflineCatalogue,
  getPosOfflineState,
  posOfflineStorageAvailable,
  recordPosOfflineCashSale,
  removePosOfflineSuspendedTicket,
  resumePosOfflineSuspendedTicket,
  savePosOfflineActiveDraft,
  suspendPosOfflineDraft,
  updatePosOfflineNetworkHint,
  type PosOfflineCatalogueInput,
  type PosOfflineCatalogueItem,
  type PosOfflineScope,
} from "@/lib/commerce-pos-offline";
import {
  commercePosDraftHasContent,
  commercePosDraftStorageKey,
  createCommercePosDraft,
  createCommercePosId,
  loadCommercePosDraft,
  loadCommercePosSuspendedTickets,
  removeCommercePosDraft,
  saveCommercePosDraft,
  saveCommercePosSuspendedTickets,
  type CommercePosDraft,
  type CommercePosSuspendedTicket,
} from "@/lib/commerce-pos-session";

interface UseCommercePosSessionOptions {
  locationId: string;
  userId: string;
  catalogue?: readonly PosOfflineCatalogueInput[];
  catalogueRevision?: number;
}

export type CommercePosNetworkStatus = "ONLINE" | "OFFLINE" | "UNAVAILABLE" | "UNKNOWN";
export type CommercePosStorageMode = "INDEXEDDB" | "LOCAL_STORAGE" | "UNAVAILABLE";

function getBrowserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function getInitialNetworkStatus(): CommercePosNetworkStatus {
  if (typeof navigator === "undefined") return "UNKNOWN";
  return navigator.onLine ? "ONLINE" : "OFFLINE";
}

function createScope(locationId: string, userId: string): PosOfflineScope | null {
  return locationId && userId ? { locationId, userId } : null;
}

export function useCommercePosSession({ locationId, userId, catalogue, catalogueRevision }: UseCommercePosSessionOptions) {
  const scope = useMemo(() => createScope(locationId, userId), [locationId, userId]);
  const storageKey = useMemo(
    () => (scope ? commercePosDraftStorageKey(scope.locationId, scope.userId) : null),
    [scope],
  );
  const [draft, setDraft] = useState<CommercePosDraft | null>(null);
  const [suspendedTickets, setSuspendedTickets] = useState<CommercePosSuspendedTicket[]>([]);
  const [catalogueItems, setCatalogueItems] = useState<PosOfflineCatalogueItem[]>([]);
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0);
  const [storageMode, setStorageMode] = useState<CommercePosStorageMode>("UNAVAILABLE");
  const [networkStatus, setNetworkStatus] = useState<CommercePosNetworkStatus>(getInitialNetworkStatus);
  const [isRestored, setIsRestored] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const catalogueRevisionRef = useRef<string | null>(null);

  const refreshOfflineState = useCallback(async (currentScope: PosOfflineScope) => {
    const state = await getPosOfflineState(currentScope);
    setCatalogueItems(state.catalogue);
    setPendingOutboxCount(state.pendingOutboxCount);
    return state;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsReady(false);
    setIsRestored(false);
    catalogueRevisionRef.current = null;

    if (!scope) {
      setDraft(null);
      setSuspendedTickets([]);
      setCatalogueItems([]);
      setPendingOutboxCount(0);
      setStorageMode("UNAVAILABLE");
      return () => { cancelled = true; };
    }

    const restore = async () => {
      const storage = getBrowserStorage();
      if (posOfflineStorageAvailable()) {
        try {
          let state = await refreshOfflineState(scope);
          const legacyDraft = storage ? loadCommercePosDraft(storage, scope.locationId, scope.userId) : null;
          const legacySuspended = storage ? loadCommercePosSuspendedTickets(storage, scope.locationId, scope.userId) : [];
          const hasStoredOfflineState = Boolean(state.activeDraft || state.suspendedTickets.length);

          if (!hasStoredOfflineState) {
            const nextDraft = legacyDraft ?? createCommercePosDraft(scope.locationId, scope.userId);
            await savePosOfflineActiveDraft(scope, nextDraft);
            for (const ticket of legacySuspended) await suspendPosOfflineDraft(scope, ticket);

            // Legacy browser data is removed only after its IndexedDB copy exists.
            if (storage && (legacyDraft || legacySuspended.length)) {
              removeCommercePosDraft(storage, scope.locationId, scope.userId);
              saveCommercePosSuspendedTickets(storage, scope.locationId, scope.userId, []);
            }
            state = await refreshOfflineState(scope);
          }

          if (cancelled) return;
          const restoredDraft = state.activeDraft ?? createCommercePosDraft(scope.locationId, scope.userId);
          if (!state.activeDraft) await savePosOfflineActiveDraft(scope, restoredDraft);
          setDraft(restoredDraft.checkoutState === "PROCESSING"
            ? { ...restoredDraft, checkoutState: "RECONCILIATION_REQUIRED" }
            : restoredDraft);
          setSuspendedTickets(state.suspendedTickets);
          setCatalogueItems(state.catalogue);
          setPendingOutboxCount(state.pendingOutboxCount);
          setStorageMode("INDEXEDDB");
          setIsRestored(Boolean((state.activeDraft && commercePosDraftHasContent(state.activeDraft)) || state.suspendedTickets.length));
          setIsReady(true);
          return;
        } catch (error) {
          // IndexedDB can be disabled by browser privacy settings. Preserve the
          // existing online POS rather than dropping a cashier's active ticket.
          console.warn("Le stockage IndexedDB de la caisse est indisponible.", error);
        }
      }

      if (cancelled) return;
      if (!storage || !storageKey) {
        setStorageMode("UNAVAILABLE");
        // Online checkout remains usable even when a browser blocks every
        // persistent storage mechanism. Only the offline capability is lost.
        setDraft(createCommercePosDraft(scope.locationId, scope.userId));
        setSuspendedTickets([]);
        setCatalogueItems([]);
        setPendingOutboxCount(0);
        setIsReady(true);
        return;
      }

      const restored = loadCommercePosDraft(storage, scope.locationId, scope.userId);
      const normalizedRestored = restored?.checkoutState === "PROCESSING"
        ? { ...restored, checkoutState: "RECONCILIATION_REQUIRED" as const }
        : restored;
      setDraft(normalizedRestored ?? createCommercePosDraft(scope.locationId, scope.userId));
      setSuspendedTickets(loadCommercePosSuspendedTickets(storage, scope.locationId, scope.userId));
      setCatalogueItems([]);
      setPendingOutboxCount(0);
      setStorageMode("LOCAL_STORAGE");
      setIsRestored(Boolean(normalizedRestored && commercePosDraftHasContent(normalizedRestored)));
      setIsReady(true);
    };

    void restore();
    return () => { cancelled = true; };
  }, [refreshOfflineState, scope, storageKey]);

  useEffect(() => {
    if (!scope || !catalogue || storageMode !== "INDEXEDDB" || !isReady) return;
    const revision = `${catalogueRevision ?? "unknown"}:${catalogue.map((item) => `${item.id}:${item.quantity}:${item.salePrice ?? ""}`).join("|")}`;
    if (catalogueRevisionRef.current === revision) return;
    catalogueRevisionRef.current = revision;
    void cachePosOfflineCatalogue(scope, catalogue)
      .then((items) => setCatalogueItems(items))
      .catch((error: unknown) => console.warn("Le catalogue hors connexion n’a pas pu être mis à jour.", error));
  }, [catalogue, catalogueRevision, isReady, scope, storageMode]);

  useEffect(() => {
    if (!scope || storageMode !== "INDEXEDDB" || !isReady) return;
    const updateNetworkState = (nextStatus: CommercePosNetworkStatus) => {
      setNetworkStatus(nextStatus);
      void updatePosOfflineNetworkHint(scope, nextStatus === "ONLINE" ? "ONLINE" : nextStatus === "OFFLINE" ? "OFFLINE" : "UNKNOWN").catch((error: unknown) => {
        console.warn("L’état réseau de la caisse n’a pas pu être enregistré localement.", error);
      });
    };
    updateNetworkState(getInitialNetworkStatus());
    const onOnline = () => updateNetworkState("ONLINE");
    const onOffline = () => updateNetworkState("OFFLINE");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [isReady, scope, storageMode]);

  useEffect(() => {
    const storage = getBrowserStorage();
    if (!scope || !draft || draft.locationId !== scope.locationId || draft.userId !== scope.userId || !isReady) return;
    if (storageMode === "INDEXEDDB") {
      void savePosOfflineActiveDraft(scope, draft).catch((error: unknown) => console.warn("Le brouillon de caisse n’a pas pu être sauvegardé localement.", error));
      return;
    }
    if (storageMode === "LOCAL_STORAGE" && storage) saveCommercePosDraft(storage, draft);
  }, [draft, isReady, scope, storageMode]);

  useEffect(() => {
    const storage = getBrowserStorage();
    if (!scope || !isReady) return;
    if (storageMode === "LOCAL_STORAGE" && storage) {
      saveCommercePosSuspendedTickets(storage, scope.locationId, scope.userId, suspendedTickets);
    }
  }, [isReady, scope, storageMode, suspendedTickets]);

  const updateDraft = useCallback((updater: (current: CommercePosDraft) => CommercePosDraft) => {
    setDraft((current) => {
      if (!current) return current;
      return { ...updater(current), updatedAt: new Date().toISOString() };
    });
  }, []);

  const clearDraft = useCallback(() => {
    if (!scope) return;
    const nextDraft = createCommercePosDraft(scope.locationId, scope.userId);
    setDraft(nextDraft);
    setIsRestored(false);
    if (storageMode === "INDEXEDDB") {
      void savePosOfflineActiveDraft(scope, nextDraft).catch((error: unknown) => console.warn("Le nouveau ticket de caisse n’a pas pu être sauvegardé.", error));
    } else {
      const storage = getBrowserStorage();
      if (storage) removeCommercePosDraft(storage, scope.locationId, scope.userId);
    }
  }, [scope, storageMode]);

  const suspendDraft = useCallback(() => {
    if (!scope || !draft || !commercePosDraftHasContent(draft) || draft.checkoutState !== "READY") return false;
    const suspendedAt = new Date().toISOString();
    const ticket: CommercePosSuspendedTicket = {
      id: createCommercePosId("suspended"),
      suspendedAt,
      draft: { ...draft, updatedAt: suspendedAt },
    };
    const nextDraft = createCommercePosDraft(scope.locationId, scope.userId);
    setSuspendedTickets((tickets) => [ticket, ...tickets]);
    setDraft(nextDraft);
    setIsRestored(false);
    if (storageMode === "INDEXEDDB") {
      void (async () => {
        await suspendPosOfflineDraft(scope, ticket);
        await savePosOfflineActiveDraft(scope, nextDraft);
      })().catch((error: unknown) => console.warn("Le ticket suspendu n’a pas pu être sauvegardé.", error));
    }
    return true;
  }, [draft, scope, storageMode]);

  const resumeSuspendedTicket = useCallback((ticketId: string) => {
    const ticket = suspendedTickets.find((entry) => entry.id === ticketId);
    if (!ticket || !scope) return false;
    const nextDraft = { ...ticket.draft, updatedAt: new Date().toISOString() };
    setDraft(nextDraft);
    setSuspendedTickets((tickets) => tickets.filter((entry) => entry.id !== ticketId));
    setIsRestored(false);
    if (storageMode === "INDEXEDDB") {
      void resumePosOfflineSuspendedTicket(scope, ticketId)
        .then((storedDraft) => storedDraft ? savePosOfflineActiveDraft(scope, storedDraft) : undefined)
        .catch((error: unknown) => console.warn("Le ticket suspendu n’a pas pu être repris localement.", error));
    }
    return true;
  }, [scope, storageMode, suspendedTickets]);

  const removeSuspendedTicket = useCallback((ticketId: string) => {
    if (!scope) return;
    setSuspendedTickets((tickets) => tickets.filter((ticket) => ticket.id !== ticketId));
    if (storageMode === "INDEXEDDB") {
      void removePosOfflineSuspendedTicket(scope, ticketId).catch((error: unknown) => console.warn("Le ticket suspendu n’a pas pu être supprimé localement.", error));
    }
  }, [scope, storageMode]);

  const completeOfflineCashSale = useCallback(async (): Promise<string> => {
    if (!scope || !draft || storageMode !== "INDEXEDDB") throw new Error("La vente hors connexion requiert le stockage local de caisse.");
    const result = await recordPosOfflineCashSale(scope, draft);
    setDraft(result.nextDraft);
    setIsRestored(false);
    setCatalogueItems(await getPosOfflineCatalogue(scope));
    setPendingOutboxCount((count) => count + 1);
    return result.eventId;
  }, [draft, scope, storageMode]);

  const reportNetworkFailure = useCallback(() => {
    setNetworkStatus("UNAVAILABLE");
    if (scope && storageMode === "INDEXEDDB") {
      void updatePosOfflineNetworkHint(scope, "UNKNOWN").catch((error: unknown) => console.warn("L’état réseau n’a pas pu être mis à jour localement.", error));
    }
  }, [scope, storageMode]);

  return {
    draft,
    isReady: isReady && Boolean(draft && scope && draft.locationId === scope.locationId && draft.userId === scope.userId),
    isRestored,
    storageMode,
    networkStatus,
    catalogueItems,
    pendingOutboxCount,
    canCompleteOfflineCashSale: storageMode === "INDEXEDDB" && networkStatus !== "ONLINE",
    updateDraft,
    clearDraft,
    suspendedTickets,
    suspendDraft,
    resumeSuspendedTicket,
    removeSuspendedTicket,
    completeOfflineCashSale,
    reportNetworkFailure,
  };
}
