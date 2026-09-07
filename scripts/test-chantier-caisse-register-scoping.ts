// CHANTIER CAISSE : multi-caisses / offline / clôture / nouvelle UX.
//
// Ce script mirrore littéralement -- sans les importer -- cinq comportements
// purs introduits ou modifiés par ce chantier, répartis entre le client
// (src/lib/commerce-pos-offline.ts, src/lib/commerce-pos-session.ts) et le
// serveur (supabase/migrations/20260907100000.../20260907110000...). Si
// l'une de ces implémentations change un jour sans mettre à jour son
// mirroir ici (ou l'inverse), relire les deux côte à côte avant de faire
// confiance à ce test.
import assert from "node:assert/strict";
import { z } from "zod";

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

// 6. BUG PRODUCTION corrigé le 07/09 : create_commerce_cash_register /
// update_commerce_cash_register renvoyaient RETURNS public.commerce_cash_
// registers (le type composite brut de la table, sérialisé is_active
// snake_case par PostgREST) au lieu d'un jsonb_build_object camelCase --
// exactement le même schéma Zod que get_commerce_cash_registers (qui,
// lui, était déjà correct) échouait donc systématiquement avec
// "invalid_type, path: [isActive], message: Required" sur ces deux
// réponses précises. Mirroir exact de commerceCashRegisterSchema
// (src/lib/commerce-pos.functions.ts) -- si l'une change sans l'autre,
// relire les deux côte à côte.
const commerceCashRegisterSchemaMirror = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
});

// 1. scopeKey (commerce-pos-offline.ts) -- partitionnement IndexedDB par
// poste. null = comportement historique inchangé (clé à 2 segments).
type PosOfflineScope = { locationId: string; userId: string; registerId: string | null };
function scopeKey({ locationId, userId, registerId }: PosOfflineScope): string {
  return registerId ? `${locationId}:${userId}:${registerId}` : `${locationId}:${userId}`;
}

// 2. Reconstruction locationId/userId depuis un scopeKey (ticketToDraft) --
// split(":") plutôt que l'ancien lastIndexOf(":"), qui coupait un
// registerId à 3 segments comme s'il faisait partie de userId.
function parseScopeKey(key: string): { locationId: string; userId: string } {
  const parts = key.split(":");
  return { locationId: parts[0] ?? "", userId: parts[1] ?? "" };
}

// 3. commercePosDraftStorageKey (commerce-pos-session.ts) -- même principe
// côté repli localStorage (IndexedDB indisponible).
function draftStorageKey(locationId: string, userId: string, registerId?: string | null): string {
  return registerId
    ? `halal_erp_pos_draft:${locationId}:${userId}:${registerId}`
    : `halal_erp_pos_draft:${locationId}:${userId}`;
}

// 4. _internal_commerce_pos_register_access (migration 20260907100000) --
// qui peut utiliser quel poste.
function registerAccess(input: {
  canManageLocations: boolean;
  assignedRegisterId: string | null | undefined;
  requestedRegisterId: string | null;
}): boolean {
  if (input.canManageLocations) return true;
  if (input.assignedRegisterId === undefined) return false; // aucune affectation active
  if (input.assignedRegisterId === null) return true; // affectation "tout le magasin"
  return input.assignedRegisterId === input.requestedRegisterId;
}

// 5. open_commerce_pos_cash_session (migration 20260907110000) -- matrice de
// décision à l'ouverture d'un poste nommé.
type OpenOutcome = "REPLAY" | "RESUMED" | "REGISTER_BUSY" | "OPENED";
function decideOpenOutcome(input: {
  existingForThisSessionId: boolean;
  registerAlreadyOpenBy: string | null; // null = poste libre
  requestingCashierId: string;
}): OpenOutcome {
  if (input.existingForThisSessionId) return "REPLAY";
  if (input.registerAlreadyOpenBy === null) return "OPENED";
  return input.registerAlreadyOpenBy === input.requestingCashierId ? "RESUMED" : "REGISTER_BUSY";
}

function run(): void {
  // -- 1. scopeKey --
  expect(
    scopeKey({ locationId: "loc-1", userId: "user-1", registerId: null }) === "loc-1:user-1",
    "registerId null doit produire exactement le format historique à 2 segments -- aucune migration de données existante requise.",
  );
  expect(
    scopeKey({ locationId: "loc-1", userId: "user-1", registerId: "reg-1" }) ===
      "loc-1:user-1:reg-1",
    "registerId défini doit produire 3 segments -- partitionnement réel par poste.",
  );

  // -- 2. parseScopeKey (ticketToDraft) --
  expect(
    JSON.stringify(parseScopeKey("loc-1:user-1")) ===
      JSON.stringify({ locationId: "loc-1", userId: "user-1" }),
    "Une clé à 2 segments (magasin non migré) doit toujours se reconstruire correctement.",
  );
  expect(
    JSON.stringify(parseScopeKey("loc-1:user-1:reg-1")) ===
      JSON.stringify({ locationId: "loc-1", userId: "user-1" }),
    'Une clé à 3 segments doit ignorer le registerId et reconstruire locationId/userId correctement -- c\'est exactement le bug que l\'ancien lastIndexOf(":") aurait introduit (il aurait renvoyé userId="reg-1", locationId inchangé par coïncidence uniquement parce qu\'il n\'y a qu\'un ":" avant le premier segment).',
  );

  // -- 3. draftStorageKey (repli localStorage) --
  expect(
    draftStorageKey("loc-1", "user-1") === "halal_erp_pos_draft:loc-1:user-1",
    "Sans registerId, la clé de repli localStorage doit rester strictement identique au format historique.",
  );
  expect(
    draftStorageKey("loc-1", "user-1", "reg-1") === "halal_erp_pos_draft:loc-1:user-1:reg-1",
    "Avec registerId, la clé de repli localStorage doit elle aussi être partitionnée par poste -- même principe que scopeKey côté IndexedDB.",
  );

  // -- 4. registerAccess --
  expect(
    registerAccess({
      canManageLocations: true,
      assignedRegisterId: undefined,
      requestedRegisterId: "reg-1",
    }) === true,
    "locations.manage donne accès à tout poste, même sans affectation personnelle (ex. super_admin/admin).",
  );
  expect(
    registerAccess({
      canManageLocations: false,
      assignedRegisterId: undefined,
      requestedRegisterId: "reg-1",
    }) === false,
    "Sans locations.manage ni affectation active à ce magasin, aucun accès -- refusé.",
  );
  expect(
    registerAccess({
      canManageLocations: false,
      assignedRegisterId: null,
      requestedRegisterId: "reg-1",
    }) === true,
    "Affectation \"tout le magasin\" (cash_register_id NULL) donne accès à n'importe quel poste actif de ce magasin -- comportement historique préservé pour toute ligne d'affectation déjà existante.",
  );
  expect(
    registerAccess({
      canManageLocations: false,
      assignedRegisterId: "reg-1",
      requestedRegisterId: "reg-1",
    }) === true,
    "Affectation à un poste précis donne accès à CE poste.",
  );
  expect(
    registerAccess({
      canManageLocations: false,
      assignedRegisterId: "reg-1",
      requestedRegisterId: "reg-2",
    }) === false,
    "Affectation à un poste précis refuse tout AUTRE poste du même magasin -- c'est la règle métier centrale du chantier.",
  );

  // -- 5. decideOpenOutcome --
  expect(
    decideOpenOutcome({
      existingForThisSessionId: true,
      registerAlreadyOpenBy: "cashier-a",
      requestingCashierId: "cashier-a",
    }) === "REPLAY",
    "Un cash_session_id déjà connu (retry réseau, rechargement) doit toujours rejouer la même ligne -- jamais une seconde ouverture.",
  );
  expect(
    decideOpenOutcome({
      existingForThisSessionId: false,
      registerAlreadyOpenBy: null,
      requestingCashierId: "cashier-a",
    }) === "OPENED",
    "Poste libre -> ouverture normale.",
  );
  expect(
    decideOpenOutcome({
      existingForThisSessionId: false,
      registerAlreadyOpenBy: "cashier-a",
      requestingCashierId: "cashier-a",
    }) === "RESUMED",
    "Poste déjà ouvert par LE MÊME caissier (ex. stockage local effacé, nouvel identifiant local) -> reprise de la session existante, jamais une seconde ouverture silencieuse sur le même poste.",
  );
  expect(
    decideOpenOutcome({
      existingForThisSessionId: false,
      registerAlreadyOpenBy: "cashier-a",
      requestingCashierId: "cashier-b",
    }) === "REGISTER_BUSY",
    "Poste déjà ouvert par un AUTRE caissier -> refusé avec un signal explicite -- exactement le cas que la mission demande de rendre détectable (aujourd'hui : aucune détection possible, deux caissiers pourraient silencieusement partager le même poste).",
  );

  // -- 6. commerceCashRegisterSchema contract (isActive) --
  const rawComposite = {
    id: "605f5307-823f-4597-803e-401882fde495",
    business_location_id: "d528b00e-2019-4b57-9d73-5368b0d00b0e",
    name: "CAISSE 2",
    is_active: true,
    created_by: null,
    updated_by: null,
    created_at: "2026-09-07T00:00:00Z",
    updated_at: "2026-09-07T00:00:00Z",
  };
  const compositeResult = commerceCashRegisterSchemaMirror.safeParse(rawComposite);
  expect(
    compositeResult.success === false,
    "Le type composite brut (is_active snake_case, pas de clé isActive) doit être rejeté -- c'est exactement le bug de production : RETURNS public.commerce_cash_registers sérialisé par PostgREST avec les noms de colonnes réels.",
  );
  if (!compositeResult.success) {
    const issue = compositeResult.error.issues.find((entry) => entry.path.join(".") === "isActive");
    expect(
      issue !== undefined && issue.code === "invalid_type" && issue.message === "Required",
      `Le rejet doit précisément correspondre à l'erreur observée en production (invalid_type, path ["isActive"], message "Required") -- reçu : ${JSON.stringify(compositeResult.error.issues)}`,
    );
  }
  const camelCaseResult = commerceCashRegisterSchemaMirror.safeParse({
    id: "605f5307-823f-4597-803e-401882fde495",
    name: "CAISSE 2",
    isActive: true,
  });
  expect(
    camelCaseResult.success === true,
    "Le contrat corrigé (jsonb_build_object avec isActive camelCase, exactement ce que create/update_commerce_cash_register renvoient depuis 20260907130000) doit être accepté sans erreur.",
  );

  console.log("CHANTIER CAISSE register-scoping tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
