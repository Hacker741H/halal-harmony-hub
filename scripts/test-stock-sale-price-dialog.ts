// Parcours transfert -> stock -> prix de vente -> Caisse (suite du correctif
// "article transféré indisponible") : depuis /commerce, "Prix de vente à
// définir" devient cliquable et ouvre un dialogue pour définir/éditer
// sale_price, sans jamais toucher quantity/CUMP/reorderLevel/Finance.
//
// Ce script mirrore littéralement les deux calculs de src/components/
// commerce/store-management-cockpit.tsx (SalePriceEditDialog) : la
// validation du champ prix (isValidDraft) et la marge estimée par unité
// (marginPerUnit), qui ne doit jamais être calculée sur un brouillon
// invalide ou un coût inconnu.
import assert from "node:assert/strict";

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

// Mirroir exact de isValidDraft dans SalePriceEditDialog. Règle métier
// verrouillée : un sale_price normal est strictement positif -- 0 n'est
// plus valide (une gratuité éventuelle sera un workflow dédié plus tard).
function isValidDraft(priceDraft: string): boolean {
  const parsed = Number(priceDraft);
  return priceDraft.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
}

// Mirroir exact de marginPerUnit dans SalePriceEditDialog.
function marginPerUnit(priceDraft: string, unitCost: number | null): number | null {
  const parsed = Number(priceDraft);
  if (unitCost === null || !isValidDraft(priceDraft)) return null;
  return parsed - unitCost;
}

function run(): void {
  // 1. Le cas réel du rapport : "Sac Bafinka", stock=1, prix absent, saisie
  // de 8000 -- doit être accepté et produire la bonne marge.
  expect(isValidDraft("8000"), "Un prix positif saisi doit être valide.");
  expect(marginPerUnit("8000", 5000) === 3000, "CUMP 5000, prix saisi 8000 : marge estimée = 3000.");

  // 2. Un champ vide (avant toute saisie, cas d'un article sans prix) ne
  // doit jamais être traité comme un prix de 0 valide -- Number("") === 0
  // en JS, piège classique qu'isValidDraft doit éviter explicitement.
  expect(isValidDraft("") === false, "Un champ vide ne doit jamais être considéré comme un prix valide (piège Number('') === 0).");
  expect(marginPerUnit("", 5000) === null, "Aucune marge ne doit être affichée tant qu'aucun prix n'est saisi.");

  // 3. Un prix négatif est rejeté (protège le bouton Enregistrer même avant
  // que la RPC ne le revérifie server-side).
  expect(isValidDraft("-100") === false, "Un prix négatif ne doit jamais être valide.");

  // 4. Zéro est désormais refusé -- un sale_price normal est strictement
  // positif, distinct à la fois d'un champ vide (prix pas encore défini)
  // et d'un prix négatif. Une gratuité éventuelle sera traitée par un
  // workflow dédié plus tard, jamais par sale_price = 0.
  expect(isValidDraft("0") === false, "0 doit être refusé -- un sale_price normal est strictement positif.");
  expect(isValidDraft("0.00") === false, "0.00 doit aussi être refusé -- même règle, quelle que soit la notation décimale.");
  expect(isValidDraft("1"), "1 doit rester valide -- la borne est bien > 0, pas une restriction plus large.");

  // 5. Éditer un prix déjà existant (Sac eastpak, 9000) doit fonctionner
  // identiquement -- même mécanisme, pas de branche séparée.
  expect(isValidDraft("9000"), "Un prix déjà existant reste éditable via le même mécanisme.");
  expect(marginPerUnit("9500", 6000) === 3500, "Éditer un prix existant recalcule la marge normalement.");

  // 6. Coût inconnu (unitCost null) : jamais de marge affichée, même avec
  // un prix par ailleurs valide -- pas de calcul trompeur sur une base
  // manquante.
  expect(marginPerUnit("8000", null) === null, "Sans CUMP connu, aucune marge ne doit être affichée, même avec un prix valide.");

  console.log("Stock sale-price dialog tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
