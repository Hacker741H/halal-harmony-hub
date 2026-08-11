import { useCallback, useEffect, useMemo, useState } from "react";

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
}

function getBrowserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function useCommercePosSession({ locationId, userId }: UseCommercePosSessionOptions) {
  const storageKey = useMemo(
    () => (locationId && userId ? commercePosDraftStorageKey(locationId, userId) : null),
    [locationId, userId],
  );
  const [draft, setDraft] = useState<CommercePosDraft | null>(null);
  const [suspendedTickets, setSuspendedTickets] = useState<CommercePosSuspendedTicket[]>([]);
  const [isRestored, setIsRestored] = useState(false);

  useEffect(() => {
    const storage = getBrowserStorage();
    setIsRestored(false);

    if (!storageKey || !storage) {
      setDraft(null);
      setSuspendedTickets([]);
      return;
    }

    const restored = loadCommercePosDraft(storage, locationId, userId);
    const normalizedRestored = restored?.checkoutState === "PROCESSING"
      ? { ...restored, checkoutState: "RECONCILIATION_REQUIRED" as const }
      : restored;
    setDraft(normalizedRestored ?? createCommercePosDraft(locationId, userId));
    setSuspendedTickets(loadCommercePosSuspendedTickets(storage, locationId, userId));
    setIsRestored(Boolean(normalizedRestored && commercePosDraftHasContent(normalizedRestored)));
  }, [locationId, storageKey, userId]);

  useEffect(() => {
    const storage = getBrowserStorage();
    if (!storage || !storageKey || !draft || draft.locationId !== locationId || draft.userId !== userId) return;
    saveCommercePosDraft(storage, draft);
  }, [draft, locationId, storageKey, userId]);

  useEffect(() => {
    const storage = getBrowserStorage();
    if (!storage || !storageKey || !locationId || !userId) return;
    saveCommercePosSuspendedTickets(storage, locationId, userId, suspendedTickets);
  }, [locationId, storageKey, suspendedTickets, userId]);

  const updateDraft = useCallback((updater: (current: CommercePosDraft) => CommercePosDraft) => {
    setDraft((current) => {
      if (!current) return current;
      return { ...updater(current), updatedAt: new Date().toISOString() };
    });
  }, []);

  const clearDraft = useCallback(() => {
    const storage = getBrowserStorage();
    if (!locationId || !userId) return;
    if (storage) removeCommercePosDraft(storage, locationId, userId);
    setDraft(createCommercePosDraft(locationId, userId));
    setIsRestored(false);
  }, [locationId, userId]);

  const suspendDraft = useCallback(() => {
    if (!draft || !commercePosDraftHasContent(draft) || draft.checkoutState !== "READY") return false;

    const suspendedAt = new Date().toISOString();
    const suspendedDraft = { ...draft, updatedAt: suspendedAt };
    setSuspendedTickets((tickets) => [
      { id: createCommercePosId("suspended"), suspendedAt, draft: suspendedDraft },
      ...tickets,
    ]);
    setDraft(createCommercePosDraft(locationId, userId));
    setIsRestored(false);
    return true;
  }, [draft, locationId, userId]);

  const resumeSuspendedTicket = useCallback((ticketId: string) => {
    const ticket = suspendedTickets.find((entry) => entry.id === ticketId);
    if (!ticket) return false;

    setDraft({ ...ticket.draft, updatedAt: new Date().toISOString() });
    setSuspendedTickets((tickets) => tickets.filter((entry) => entry.id !== ticketId));
    setIsRestored(false);
    return true;
  }, [suspendedTickets]);

  const removeSuspendedTicket = useCallback((ticketId: string) => {
    setSuspendedTickets((tickets) => tickets.filter((ticket) => ticket.id !== ticketId));
  }, []);

  return {
    draft,
    isReady: Boolean(draft && draft.locationId === locationId && draft.userId === userId),
    isRestored,
    updateDraft,
    clearDraft,
    suspendedTickets,
    suspendDraft,
    resumeSuspendedTicket,
    removeSuspendedTicket,
  };
}
