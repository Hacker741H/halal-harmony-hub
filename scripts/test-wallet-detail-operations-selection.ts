// P0-A : le wallet /wallets/:id affichait "0 opération" pour tout wallet SANS
// enfant, quel que soit son historique réel (191 416 FCFA de solde, 0
// opération affichée) -- src/routes/_authenticated/wallets/$walletId.tsx,
// operationsQuery.queryFn testait `if (!hasChildren || ...) return [] ` : la
// condition `!hasChildren` court-circuitait AVANT même de regarder
// selectedChildId, donc un wallet simple (l'immense majorité, un sous-wallet
// étant toujours facultatif) ne recevait jamais ses propres opérations.
//
// Ce test mirrors exactement les deux décisions corrigées (même motif que
// test-commerce-sales-price-override.ts pour commitEditPrice) : à quelle
// fonction de récupération le wallet détail délègue selon
// hasChildren/selectedChildId, et comment computeFlows exclut désormais les
// opérations CANCELLED des totaux entrées/sorties sans jamais les cacher du
// journal lui-même.
import assert from "node:assert/strict";

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

const ALL_CHILDREN = "ALL";
const RECEIVABLES = "RECEIVABLES";

type Dispatch =
  | { fn: "byWallet"; id: string }
  | { fn: "byWalletGroup"; ids: string[] }
  | { fn: "empty" };

// Mirror of operationsQuery.queryFn's corrected branching.
function selectOperationsSource(walletId: string, hasChildren: boolean, childIds: string[], selectedChildId: string): Dispatch {
  if (selectedChildId === RECEIVABLES) return { fn: "empty" };
  if (!hasChildren) return { fn: "byWallet", id: walletId };
  if (selectedChildId === ALL_CHILDREN) return { fn: "byWalletGroup", ids: [walletId, ...childIds] };
  return { fn: "byWallet", id: selectedChildId };
}

type Op = { type: "REVENUE" | "EXPENSE" | "DEPOSIT" | "TRANSFER"; status: string; amount: number; wallet_id: string | null; destination_wallet_id: string | null };

// Mirror of computeFlows: same group/type logic, now also excluding
// CANCELLED from the sums (the row still renders in the journal itself,
// just never counted as real money moved).
function computeFlows(list: Op[], isInGroup: (id: string | null) => boolean) {
  const incoming = list
    .filter((operation) =>
      operation.status !== "CANCELLED" &&
      (operation.type === "TRANSFER"
        ? isInGroup(operation.destination_wallet_id) && !isInGroup(operation.wallet_id)
        : isInGroup(operation.wallet_id) && ["REVENUE", "DEPOSIT"].includes(operation.type)),
    )
    .reduce((sum, operation) => sum + operation.amount, 0);
  const outgoing = list
    .filter((operation) =>
      operation.status !== "CANCELLED" &&
      (operation.type === "TRANSFER"
        ? isInGroup(operation.wallet_id) && !isInGroup(operation.destination_wallet_id)
        : isInGroup(operation.wallet_id) && operation.type === "EXPENSE"),
    )
    .reduce((sum, operation) => sum + operation.amount, 0);
  return { incoming, outgoing };
}

function run(): void {
  const WALLET = "marasse";
  const CHILD_A = "wave-child";
  const CHILD_B = "especes-child";
  const inWallet = (id: string | null) => id === WALLET;

  // 1) Wallet simple (sans enfant) -- LA régression : doit toujours
  // interroger ses propres opérations, jamais renvoyer [] par défaut.
  expect(
    selectOperationsSource(WALLET, false, [], ALL_CHILDREN).fn === "byWallet",
    "Un wallet sans enfant doit charger ses propres opérations (régression : renvoyait [] pour tout wallet sans enfant).",
  );
  assert.deepEqual(selectOperationsSource(WALLET, false, [], ALL_CHILDREN), { fn: "byWallet", id: WALLET });

  // 2) Wallet parent, onglet "Tous" -- vue consolidée du groupe.
  assert.deepEqual(
    selectOperationsSource(WALLET, true, [CHILD_A, CHILD_B], ALL_CHILDREN),
    { fn: "byWalletGroup", ids: [WALLET, CHILD_A, CHILD_B] },
    "Un wallet parent sur l'onglet Tous doit charger le groupe consolidé (parent + tous les enfants).",
  );

  // 3) Wallet parent, sous-wallet sélectionné -- ses propres opérations,
  // jamais celles du parent ni des autres enfants.
  assert.deepEqual(
    selectOperationsSource(WALLET, true, [CHILD_A, CHILD_B], CHILD_A),
    { fn: "byWallet", id: CHILD_A },
    "Un sous-wallet sélectionné doit charger uniquement ses propres opérations.",
  );

  // 4) Onglet Créances (virtuel, jamais un vrai wallet) -- toujours vide,
  // qu'il y ait des enfants ou non.
  assert.deepEqual(selectOperationsSource(WALLET, true, [CHILD_A], RECEIVABLES), { fn: "empty" });
  assert.deepEqual(selectOperationsSource(WALLET, false, [], RECEIVABLES), { fn: "empty" });

  // 5) Wallet sans opération -- ne doit jamais planter, doit renvoyer 0/0.
  expect(
    JSON.stringify(computeFlows([], inWallet)) === JSON.stringify({ incoming: 0, outgoing: 0 }),
    "Un wallet sans aucune opération doit produire {incoming:0, outgoing:0}, jamais une exception.",
  );

  // 6) Matrice complète des types + CANCELLED (REVENUE/EXPENSE/TRANSFER/
  // CANCELLED demandés explicitement) -- une opération annulée ne doit
  // jamais gonfler entrées/sorties, qu'elle soit une recette ou une dépense.
  const ops: Op[] = [
    { type: "REVENUE", status: "VALIDE", amount: 1000, wallet_id: WALLET, destination_wallet_id: null },
    { type: "DEPOSIT", status: "VALIDE", amount: 500, wallet_id: WALLET, destination_wallet_id: null },
    { type: "EXPENSE", status: "VALIDE", amount: 300, wallet_id: WALLET, destination_wallet_id: null },
    { type: "EXPENSE", status: "CANCELLED", amount: 9000, wallet_id: WALLET, destination_wallet_id: null }, // must NOT count
    { type: "REVENUE", status: "CANCELLED", amount: 7000, wallet_id: WALLET, destination_wallet_id: null }, // must NOT count
    { type: "TRANSFER", status: "VALIDE", amount: 200, wallet_id: "other-wallet", destination_wallet_id: WALLET }, // incoming transfer
    { type: "TRANSFER", status: "VALIDE", amount: 150, wallet_id: WALLET, destination_wallet_id: "other-wallet" }, // outgoing transfer
  ];
  const flows = computeFlows(ops, inWallet);
  expect(flows.incoming === 1000 + 500 + 200, `Entrées attendues 1700 (REVENUE+DEPOSIT+transfert reçu, CANCELLED exclu), obtenu ${flows.incoming}.`);
  expect(flows.outgoing === 300 + 150, `Sorties attendues 450 (EXPENSE+transfert émis, CANCELLED exclu), obtenu ${flows.outgoing}.`);

  // 7) Transfert interne au groupe (parent<->enfant) ne doit toucher ni les
  // entrées ni les sorties consolidées -- seul un transfert qui franchit la
  // frontière du groupe compte.
  const inGroup = (id: string | null) => id === WALLET || id === CHILD_A || id === CHILD_B;
  const internalTransfer: Op[] = [{ type: "TRANSFER", status: "VALIDE", amount: 999, wallet_id: CHILD_A, destination_wallet_id: CHILD_B }];
  const internalFlows = computeFlows(internalTransfer, inGroup);
  expect(
    internalFlows.incoming === 0 && internalFlows.outgoing === 0,
    "Un transfert dont les DEUX jambes sont dans le groupe (parent+enfants) ne doit affecter ni les entrées ni les sorties consolidées.",
  );

  console.log("Wallet detail operations-selection tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
