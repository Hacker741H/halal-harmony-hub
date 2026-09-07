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
// 7. BUG PRODUCTION corrigé le 07/09, PUIS RETROUVÉ le 07/09 (AUDIT TOTAL)
// dans un DEUXIÈME écran : "Ouvrir la caisse" depuis MAGASIN MARIAM
// atterrissait sur ACCESSOIRES ET DIVERS (/caisse), puis /commerce
// lui-même s'est révélé avoir exactement le même défaut à l'identique --
// son propre useState local pour le magasin courant repartait de "" à
// chaque refresh et retombait sur locationsQuery.data[0]. Cause commune :
// getCommercePosLocations trie par nom (ORDER BY location_row.name), donc
// "ACCESSOIRES ET DIVERS" passe systématiquement avant "MAGASIN MARIAM"
// pour quiconque a accès aux deux. Mirroir exact de
// resolveCommercePosLocationId (src/lib/commerce-pos-session.ts) --
// désormais LA seule fonction réelle appelée par CommerceCashierWorkspace
// (/caisse) ET CommerceManagementWorkspace (/commerce), pas deux copies
// qui auraient pu diverger une troisième fois. Priorité : demande
// explicite (URL) > brouillon existant (caisse uniquement, toujours null
// côté /commerce) > mono-magasin (aucune ambiguïté) > jamais un choix
// silencieux quand 2+ magasins et aucun contexte.
type LocationResolutionInput = {
  requestedLocationId: string | null;
  availableLocationIds: readonly string[];
  draftLocationId: string | null;
};
function resolveLocationId(input: LocationResolutionInput): string | null {
  if (input.requestedLocationId && input.availableLocationIds.includes(input.requestedLocationId)) {
    return input.requestedLocationId;
  }
  if (input.draftLocationId && input.availableLocationIds.includes(input.draftLocationId)) {
    return input.draftLocationId;
  }
  return input.availableLocationIds.length === 1 ? input.availableLocationIds[0] : null;
}

const commerceCashRegisterSchemaMirror = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
});

// 8. BUG UX corrigé le 07/09 : l'écran "poste occupé" n'affichait que
// Réessayer pour MAGASIN MARIAM. Cause : get_commerce_pos_available_
// registers filtrait déjà sur is_active -- avec un seul poste actif
// (CAISSE 2, CAISSE MARIAM alors inactif), le bouton "choisir un autre
// poste" (gated sur registers.length > 1 côté UI) ne s'affichait jamais.
// Mirroir de la fusion occupation (useCommercePosRegisterSelection,
// src/hooks/use-commerce-pos-register.ts) et du filtrage actif/inactif
// pour la décision d'auto-sélection. cashierId/isMine ajoutés au correctif
// suivant (item 9) -- même mirroir, pas un second.
type RawRegister = { id: string; name: string; isActive: boolean };
type OpenSession = {
  cashRegisterId: string | null;
  cashierId: string;
  cashier: string;
  openedAtServer: string;
};
type EnrichedRegister = RawRegister & {
  occupiedBy: { cashier: string; since: string; isMine: boolean } | null;
};
function enrichRegisters(
  raw: RawRegister[],
  openSessions: OpenSession[],
  currentUserId: string,
): EnrichedRegister[] {
  const openByRegisterId = new Map(
    openSessions
      .filter((session) => session.cashRegisterId)
      .map((session) => [session.cashRegisterId, session]),
  );
  return raw.map((register) => {
    const open = openByRegisterId.get(register.id);
    return {
      ...register,
      occupiedBy: open
        ? {
            cashier: open.cashier,
            since: open.openedAtServer,
            isMine: open.cashierId === currentUserId,
          }
        : null,
    };
  });
}
// BUG PRODUCTION corrigé le 07/09 : occupé PAR MOI-MÊME n'est jamais un
// blocage -- seul un poste occupé par quelqu'un d'AUTRE reste désactivé
// (RÈGLE FINALE : OPEN + même user_id + même cash_register_id -> RESUME).
function isRegisterSelectable(register: EnrichedRegister): boolean {
  return register.isActive && (!register.occupiedBy || register.occupiedBy.isMine);
}
// Mirroir de la priorité de résolution automatique (2+ postes actifs) :
// ma propre session déjà ouverte gagne AVANT le choix mémorisé en
// localStorage -- c'est ce qui rend "refresh" et "logout/login" robustes
// de la même façon, puisque ce signal vient du serveur, jamais du
// navigateur.
function resolveActiveRegisterId(
  activeRegisters: RawRegister[],
  openSessions: OpenSession[],
  currentUserId: string,
  rememberedRegisterId: string | null,
): string | null {
  const myOpenSession = openSessions.find(
    (session) =>
      session.cashierId === currentUserId &&
      session.cashRegisterId !== null &&
      activeRegisters.some((register) => register.id === session.cashRegisterId),
  );
  if (myOpenSession?.cashRegisterId) return myOpenSession.cashRegisterId;
  if (
    rememberedRegisterId &&
    activeRegisters.some((register) => register.id === rememberedRegisterId)
  ) {
    return rememberedRegisterId;
  }
  return null;
}

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

  // -- 7. resolveLocationId (priorité de résolution du magasin) --
  const magasinMariam = "d528b00e-2019-4b57-9d73-5368b0d00b0e";
  const accessoires = "ee301cda-0cd5-4463-b8ad-75986b7dd58c";
  expect(
    resolveLocationId({
      requestedLocationId: magasinMariam,
      availableLocationIds: [accessoires, magasinMariam],
      draftLocationId: accessoires,
    }) === magasinMariam,
    "Une demande explicite (bouton \"Ouvrir la caisse\" pour MAGASIN MARIAM) doit gagner même si un brouillon existant pointe vers un AUTRE magasin (ACCESSOIRES ET DIVERS) -- c'est exactement le scénario du bug d'origine.",
  );
  expect(
    resolveLocationId({
      requestedLocationId: null,
      availableLocationIds: [accessoires, magasinMariam],
      draftLocationId: magasinMariam,
    }) === magasinMariam,
    "Sans demande explicite (refresh brut sur /caisse), le brouillon existant reste consulté normalement.",
  );
  expect(
    resolveLocationId({
      requestedLocationId: null,
      availableLocationIds: [magasinMariam],
      draftLocationId: null,
    }) === magasinMariam,
    "Un seul magasin accessible : aucune ambiguïté, sélection automatique -- comportement historique inchangé pour un caissier mono-magasin.",
  );
  expect(
    resolveLocationId({
      requestedLocationId: null,
      availableLocationIds: [accessoires, magasinMariam],
      draftLocationId: null,
    }) === null,
    "2+ magasins, aucune demande explicite, aucun brouillon : ne jamais choisir silencieusement le premier -- null déclenche l'écran de choix explicite, jamais availableLocationIds[0].",
  );
  expect(
    resolveLocationId({
      requestedLocationId: "un-id-perime-qui-nexiste-plus",
      availableLocationIds: [accessoires, magasinMariam],
      draftLocationId: null,
    }) === null,
    "Un identifiant demandé qui ne figure plus dans les magasins accessibles (lien obsolète) doit être ignoré, pas suivi aveuglément.",
  );

  // -- 8. Fusion occupation + scénario exact du rapport : MAGASIN MARIAM ->
  // CAISSE 2 occupée (par un AUTRE utilisateur, Fabiola -- donnée réelle,
  // voir item 9) -> choisir autre caisse -> ouverture d'un poste libre.
  const caisse2 = "56ef5a70-ad1f-433b-be00-dc796252bcac";
  const caisseMariamInactive = "7cd5e664-9814-4a04-b12e-eb2cfd1a6886";
  const caisseMariamActive = "df449a49-e4c4-4af2-b708-0a24ee4683e8";
  const mariamId = "5ba008c0-4f9b-45b2-ac71-769a1c3e0085";
  const fabiolaId = "32826e72-38e7-4a28-8926-61ff842dbd52";
  const rawRegisters: RawRegister[] = [
    { id: caisse2, name: "CAISSE 2", isActive: true },
    { id: caisseMariamInactive, name: "CAISSE MARIAM", isActive: false },
    { id: caisseMariamActive, name: "CAISSE MARIAM", isActive: true },
  ];
  const openSessions: OpenSession[] = [
    {
      cashRegisterId: caisse2,
      cashierId: fabiolaId,
      cashier: "Fabiola",
      openedAtServer: "2026-09-07T13:47:41Z",
    },
  ];
  const enrichedForMariam = enrichRegisters(rawRegisters, openSessions, mariamId);
  const caisse2SeenByMariam = enrichedForMariam.find((register) => register.id === caisse2);
  const caisseMariamActiveEnriched = enrichedForMariam.find(
    (register) => register.id === caisseMariamActive,
  );
  const caisseMariamInactiveEnriched = enrichedForMariam.find(
    (register) => register.id === caisseMariamInactive,
  );
  expect(
    caisse2SeenByMariam?.occupiedBy?.cashier === "Fabiola" &&
      caisse2SeenByMariam.occupiedBy.isMine === false &&
      !isRegisterSelectable(caisse2SeenByMariam),
    "CAISSE 2 occupée par Fabiola, vue par Mariam : occupiedBy renseigné (qui, pas seulement un booléen), isMine=false, jamais sélectionnable -- un poste occupé par un AUTRE utilisateur n'est jamais ouvrable.",
  );
  expect(
    caisseMariamActiveEnriched !== undefined &&
      caisseMariamActiveEnriched.occupiedBy === null &&
      isRegisterSelectable(caisseMariamActiveEnriched),
    "CAISSE MARIAM (active, libre) reste sélectionnable même quand CAISSE 2 est occupée -- un poste occupé ne bloque jamais l'accès aux autres. C'est exactement le scénario : MAGASIN MARIAM -> CAISSE 2 occupée -> choisir autre caisse -> ouverture correcte d'un poste libre.",
  );
  expect(
    caisseMariamInactiveEnriched !== undefined &&
      !isRegisterSelectable(caisseMariamInactiveEnriched),
    "Le poste CAISSE MARIAM inactif reste visible (contexte pour l'admin) mais jamais sélectionnable.",
  );
  const activeOnly = rawRegisters.filter((register) => register.isActive);
  expect(
    activeOnly.length === 2,
    "Seuls les postes actifs (CAISSE 2, CAISSE MARIAM active) comptent pour la décision d'auto-sélection 0/1/2+ -- le poste inactif ne doit ni compter ni bloquer l'auto-sélection à poste unique dans un autre scénario.",
  );

  // -- 9. BUG PRODUCTION corrigé le 07/09 : "reprendre sa propre session".
  // Données réelles de production au moment du rapport : Mariam a CAISSE
  // MARIAM ouverte (sa propre session), Fabiola a CAISSE 2 ouverte (un
  // autre utilisateur) -- exactement les deux lignes réelles de
  // commerce_pos_cash_sessions vérifiées en direct avant ce correctif.
  const bothOpenSessions: OpenSession[] = [
    {
      cashRegisterId: caisseMariamActive,
      cashierId: mariamId,
      cashier: "Mariam Keita",
      openedAtServer: "2026-09-07T15:18:34Z",
    },
    {
      cashRegisterId: caisse2,
      cashierId: fabiolaId,
      cashier: "Fabiola",
      openedAtServer: "2026-09-07T13:47:41Z",
    },
  ];
  const activeRegisters = rawRegisters.filter((register) => register.isActive);
  const enrichedFromMariamsView = enrichRegisters(rawRegisters, bothOpenSessions, mariamId);
  const herOwnRegister = enrichedFromMariamsView.find(
    (register) => register.id === caisseMariamActive,
  );
  const fabiolasRegisterSeenByMariam = enrichedFromMariamsView.find(
    (register) => register.id === caisse2,
  );
  expect(
    herOwnRegister?.occupiedBy?.isMine === true && isRegisterSelectable(herOwnRegister),
    'BUG CORRIGÉ : Mariam regardant son PROPRE poste déjà ouvert (CAISSE MARIAM) doit le voir occupé par elle-même (isMine=true) ET sélectionnable -- avant le correctif, occupiedBy non-null désactivait la tuile inconditionnellement, affichant "occupé par Mariam" comme un blocage à Mariam elle-même.',
  );
  expect(
    fabiolasRegisterSeenByMariam?.occupiedBy?.isMine === false &&
      !isRegisterSelectable(fabiolasRegisterSeenByMariam),
    "Le poste de Fabiola (CAISSE 2), vu par Mariam, reste occupé par quelqu'un d'autre et non sélectionnable -- le correctif ne relâche jamais un poste réellement occupé par un tiers.",
  );
  // Symétrique : Fabiola regardant l'écran voit l'inverse -- jamais les
  // deux utilisateurs "propriétaires" du même poste en même temps.
  const enrichedFromFabiolasView = enrichRegisters(rawRegisters, bothOpenSessions, fabiolaId);
  const herOwnRegisterFabiola = enrichedFromFabiolasView.find(
    (register) => register.id === caisse2,
  );
  const mariamsRegisterSeenByFabiola = enrichedFromFabiolasView.find(
    (register) => register.id === caisseMariamActive,
  );
  expect(
    herOwnRegisterFabiola?.occupiedBy?.isMine === true &&
      isRegisterSelectable(herOwnRegisterFabiola),
    "Symétrique : Fabiola voit CAISSE 2 (son propre poste) comme occupé par elle-même et sélectionnable.",
  );
  expect(
    mariamsRegisterSeenByFabiola?.occupiedBy?.isMine === false &&
      !isRegisterSelectable(mariamsRegisterSeenByFabiola),
    'Fabiola essayant CAISSE MARIAM (poste de Mariam) : bloquée -- "Occupé par Mariam Keita", exactement le comportement AUTRE UTILISATEUR demandé.',
  );

  // -- 9bis. resolveActiveRegisterId -- priorité de résolution automatique.
  expect(
    resolveActiveRegisterId(activeRegisters, bothOpenSessions, mariamId, null) ===
      caisseMariamActive,
    "Mariam, aucun choix mémorisé (ex. nouvel appareil après logout/login) : sa propre session ouverte doit être retrouvée et reprise directement, sans passer par l'écran de choix -- c'est ce qui rend refresh ET logout/login robustes de la même façon, le signal venant du serveur.",
  );
  expect(
    resolveActiveRegisterId(activeRegisters, bothOpenSessions, mariamId, caisse2) ===
      caisseMariamActive,
    "Même avec un choix mémorisé en localStorage pointant vers un AUTRE poste (ex. valeur périmée), la session serveur réellement ouverte par l'utilisateur courant garde la priorité.",
  );
  expect(
    resolveActiveRegisterId(activeRegisters, [], mariamId, caisse2) === caisse2,
    "Aucune session ouverte connue (ex. get_commerce_pos_open_sessions en échec) : on retombe proprement sur le choix mémorisé, comportement historique préservé.",
  );
  expect(
    resolveActiveRegisterId(
      activeRegisters,
      [],
      "un-utilisateur-sans-session-ni-souvenir",
      null,
    ) === null,
    "Ni session serveur ni choix mémorisé : reste null -- l'écran de choix explicite prend le relais, jamais un choix silencieux.",
  );

  console.log("CHANTIER CAISSE register-scoping tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
