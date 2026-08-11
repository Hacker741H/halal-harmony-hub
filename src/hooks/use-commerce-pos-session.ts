import { useCallback, useEffect, useMemo, useState } from "react";

import {
  commercePosDraftHasContent,
  commercePosDraftStorageKey,
  createCommercePosDraft,
  loadCommercePosDraft,
  removeCommercePosDraft,
  saveCommercePosDraft,
  type CommercePosDraft,
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
  const [isRestored, setIsRestored] = useState(false);

  useEffect(() => {
    const storage = getBrowserStorage();
    setIsRestored(false);

    if (!storageKey || !storage) {
      setDraft(null);
      return;
    }

    const restored = loadCommercePosDraft(storage, locationId, userId);
    const normalizedRestored = restored?.checkoutState === "PROCESSING"
      ? { ...restored, checkoutState: "RECONCILIATION_REQUIRED" as const }
      : restored;
    setDraft(normalizedRestored ?? createCommercePosDraft(locationId, userId));
    setIsRestored(Boolean(normalizedRestored && commercePosDraftHasContent(normalizedRestored)));
  }, [locationId, storageKey, userId]);

  useEffect(() => {
    const storage = getBrowserStorage();
    if (!storage || !storageKey || !draft || draft.locationId !== locationId || draft.userId !== userId) return;
    saveCommercePosDraft(storage, draft);
  }, [draft, locationId, storageKey, userId]);

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

  return {
    draft,
    isReady: Boolean(draft && draft.locationId === locationId && draft.userId === userId),
    isRestored,
    updateDraft,
    clearDraft,
  };
}
