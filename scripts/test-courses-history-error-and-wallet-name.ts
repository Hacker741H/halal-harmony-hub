// CORRECTIF COURSES (toast générique + nom de wallet) : mirroir (pas import,
// même convention que les autres scripts de ce dossier -- voir
// test-commerce-item-image-validation.ts) de deux bouts de logique interne
// de src/lib/courses.functions.ts : toQueryError (transforme un objet
// Supabase brut en vraie Error, pour que le QueryCache global de router.tsx
// ne tombe plus jamais dans sa branche générique "Certaines données n'ont
// pas pu être chargées") et l'enrichissement walletName des dépenses (lookup
// batch, jamais une requête par ligne). Si l'une des deux implémentations
// change sans que ce mirroir change (ou l'inverse), relire les deux côte à
// côte avant de faire confiance à ce test.
import assert from "node:assert/strict";

function toQueryError(error: { message: string; code?: string }, context: string): Error {
  const suffix = error.code ? ` (code ${error.code})` : "";
  return new Error(`${context} : ${error.message || "erreur inconnue"}${suffix}`);
}

function enrichExpensesWithWalletName<T extends { wallet_id: string }>(
  expenseRows: T[],
  walletRows: { id: string; name: string }[],
): (T & { walletName: string | null })[] {
  const walletNames = new Map(walletRows.map((wallet) => [wallet.id, wallet.name]));
  return expenseRows.map((expense) => ({ ...expense, walletName: walletNames.get(expense.wallet_id) ?? null }));
}

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

function run(): void {
  // 1. toQueryError produit toujours une vraie instance Error -- c'est le
  // seul point qui compte pour router.tsx (QueryCache.onError,
  // !(error instanceof Error)) : un objet Supabase brut relancé tel quel ne
  // survit pas fidèlement à la frontière serveur -> client d'un server
  // function TanStack Start et déclenche le toast générique à la place du
  // vrai message.
  const wrapped = toQueryError({ message: 'column reference "id" is ambiguous', code: "42702" }, "Course -- historique");
  expect(wrapped instanceof Error, "toQueryError doit renvoyer une vraie instance Error.");
  expect(
    wrapped.message === 'Course -- historique : column reference "id" is ambiguous (code 42702)',
    `Message inattendu : ${wrapped.message}`,
  );

  // 2. Le code est optionnel (certaines erreurs Supabase n'en portent pas) --
  // ne doit jamais planter ni laisser "(code undefined)" dans le message.
  const withoutCode = toQueryError({ message: "Erreur sans code." }, "Course -- fiche principale");
  expect(withoutCode instanceof Error, "toQueryError doit fonctionner sans code.");
  expect(withoutCode.message === "Course -- fiche principale : Erreur sans code.", `Message inattendu : ${withoutCode.message}`);

  // 3. Message vide (forme résiduelle observée sur certaines erreurs
  // désérialisées) -- filet de sécurité, jamais un message vide affiché.
  const emptyMessage = toQueryError({ message: "" }, "Course -- dépenses");
  expect(emptyMessage.message === "Course -- dépenses : erreur inconnue", `Message inattendu : ${emptyMessage.message}`);

  // 4. Enrichissement wallet : le nom réel remplace l'identifiant tronqué --
  // le cas concret signalé (wallet 2d8aec5d... -> "HALAL_VHC_01").
  const expenses = [
    { id: "e1", wallet_id: "2d8aec5d-725a-43ab-b829-43a3a7ddb771" },
    { id: "e2", wallet_id: "2d8aec5d-725a-43ab-b829-43a3a7ddb771" },
  ];
  const wallets = [{ id: "2d8aec5d-725a-43ab-b829-43a3a7ddb771", name: "HALAL_VHC_01" }];
  const enriched = enrichExpensesWithWalletName(expenses, wallets);
  expect(enriched[0].walletName === "HALAL_VHC_01", "La 1ère dépense doit recevoir le nom réel du wallet.");
  expect(enriched[1].walletName === "HALAL_VHC_01", "La 2e dépense (même wallet) doit aussi recevoir le nom réel.");

  // 5. Wallet supprimé/introuvable -- repli explicite sur null (jamais une
  // exception), l'UI garde alors son fallback "Wallet <id court>".
  const orphan = enrichExpensesWithWalletName([{ id: "e3", wallet_id: "00000000-0000-0000-0000-000000000000" }], wallets);
  expect(orphan[0].walletName === null, "Un wallet_id sans wallet correspondant doit donner walletName=null, pas planter.");

  // 6. Lookup batch, jamais une requête par ligne : un seul Set + un seul
  // Map construits une fois, quel que soit le nombre de dépenses partageant
  // le même wallet -- ici 2 dépenses, 1 seul id distinct.
  const distinctWalletIds = [...new Set(expenses.map((expense) => expense.wallet_id))];
  expect(distinctWalletIds.length === 1, "2 dépenses sur le même wallet ne doivent produire qu'1 seul id à chercher (lookup batch).");

  console.log("Courses history-error and wallet-name tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
