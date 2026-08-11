import assert from "node:assert/strict";

import {
  commercePosDraftHasContent,
  commercePosDraftStorageKey,
  commercePosDraftTotal,
  commercePosSuspendedTicketsStorageKey,
  createCommercePosDraft,
  findCommercePosDraftLocation,
  getCommercePosStockConflicts,
  loadCommercePosDraft,
  loadCommercePosSuspendedTickets,
  parseCommercePosDraft,
  removeCommercePosDraft,
  saveCommercePosDraft,
  saveCommercePosSuspendedTickets,
  type CommercePosStorage,
} from "../src/lib/commerce-pos-session.ts";

class MemoryStorage implements CommercePosStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const storage = new MemoryStorage();
const userId = "cashier-001";
const primaryLocationId = "store-001";
const secondLocationId = "store-002";
const baseDraft = createCommercePosDraft(primaryLocationId, userId);
const activeDraft = {
  ...baseDraft,
  lines: [
    { lineId: "article-charger", lineType: "ARTICLE" as const, itemId: "charger", label: "Chargeur USB-C", quantity: 3, unitPrice: 500 },
    { lineId: "service-screen", lineType: "SERVICE" as const, itemId: "service-screen", label: "Réparation écran téléphone", quantity: 1, unitPrice: 15_000, serviceNote: "Écran remplacé" },
  ],
  clientId: "client-001",
  paymentMethod: "CASH" as const,
  cashReceived: 17_000,
};

assert.equal(commercePosDraftHasContent(activeDraft), true);
assert.equal(commercePosDraftTotal(activeDraft), 16_500, "le service de 15 000 FCFA doit entrer dans le total du ticket");
saveCommercePosDraft(storage, activeDraft);

// Desktop -> mobile -> desktop and an accidental refresh read exactly the same draft.
const desktopDraft = loadCommercePosDraft(storage, primaryLocationId, userId);
const mobileDraft = loadCommercePosDraft(storage, primaryLocationId, userId);
assert.deepEqual(mobileDraft, desktopDraft);
assert.equal(mobileDraft?.lines[0]?.quantity, 3);
assert.equal(mobileDraft?.lines[1]?.lineType, "SERVICE");
assert.equal(mobileDraft?.clientId, "client-001");
assert.equal(mobileDraft?.cashReceived, 17_000);
assert.equal(commercePosDraftTotal(mobileDraft ?? activeDraft), 16_500);
assert.equal((mobileDraft?.cashReceived ?? 0) - commercePosDraftTotal(mobileDraft ?? activeDraft), 500);
assert.equal(JSON.stringify(mobileDraft).includes("JEKO_API_KEY"), false);

// Legacy drafts are upgraded, preserving the historical article cart.
const legacyDraft = parseCommercePosDraft({
  ...baseDraft,
  version: 1,
  lines: [{ itemId: "legacy-charger", label: "Ancien chargeur", quantity: 1, unitPrice: 500 }],
}, primaryLocationId, userId);
assert.equal(legacyDraft?.version, 2);
assert.equal(legacyDraft?.lines[0]?.lineType, "ARTICLE");

// Services never participate in stock conflict validation.
assert.deepEqual(
  getCommercePosStockConflicts(activeDraft.lines, [{ itemId: "charger", label: "Chargeur USB-C", availableQuantity: 2 }]),
  [{ itemId: "charger", label: "Chargeur USB-C", requestedQuantity: 3, availableQuantity: 2 }],
);

const suspendedTickets = [
  { id: "suspended-1", suspendedAt: "2026-08-11T09:00:00.000Z", draft: activeDraft },
  { id: "suspended-2", suspendedAt: "2026-08-11T09:01:00.000Z", draft: { ...activeDraft, sessionId: "pos-second", clientId: null } },
];
saveCommercePosSuspendedTickets(storage, primaryLocationId, userId, suspendedTickets);
const reloadedSuspendedTickets = loadCommercePosSuspendedTickets(storage, primaryLocationId, userId);
assert.equal(reloadedSuspendedTickets.length, 2, "plusieurs tickets suspendus doivent survivre au rechargement");
assert.deepEqual(reloadedSuspendedTickets[0]?.draft.lines, activeDraft.lines, "la reprise doit restituer exactement les lignes");
assert.equal(findCommercePosDraftLocation(storage, [secondLocationId, primaryLocationId], userId), primaryLocationId);
assert.equal(storage.getItem(commercePosDraftStorageKey(primaryLocationId, userId)) !== null, true);
assert.equal(storage.getItem(commercePosSuspendedTicketsStorageKey(primaryLocationId, userId)) !== null, true);

// Suspending or deleting a local ticket does not invoke a financial or stock API.
saveCommercePosSuspendedTickets(storage, primaryLocationId, userId, []);
assert.equal(storage.getItem(commercePosSuspendedTicketsStorageKey(primaryLocationId, userId)), null);

removeCommercePosDraft(storage, primaryLocationId, userId);
assert.equal(storage.getItem(commercePosDraftStorageKey(primaryLocationId, userId)), null);
assert.equal(loadCommercePosDraft(storage, primaryLocationId, userId), null);

console.log("Commerce POS service and suspended-ticket session tests passed.");
