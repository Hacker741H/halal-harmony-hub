// OVERRIDE PRIX DE VENTE : mirroir (pas import, même convention que les
// autres scripts de ce dossier -- voir test-commerce-item-image-validation.ts)
// de la logique de commitEditPrice (src/components/commerce/commerce-pos-workspace.tsx)
// -- la règle par défaut (jamais en dessous du prix catalogue) reste
// inchangée pour un utilisateur sans commerce.sales.price_override ; un
// utilisateur avec cette permission peut vendre à la hausse ou à la
// baisse, mais le prix final reste toujours strictement positif dans les
// deux cas. Si commitEditPrice change sans que ce mirroir change (ou
// l'inverse), relire les deux côté à côte avant de faire confiance à ce
// test.
import assert from "node:assert/strict";

type PriceCheckResult = { ok: true } | { ok: false; error: string };

function checkPrice(parsed: number, floor: number | null, canOverridePrice: boolean): PriceCheckResult {
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, error: "Saisissez un prix valide." };
  }
  if (floor !== null && parsed < floor && !canOverridePrice) {
    return { ok: false, error: `Le prix ne peut pas être inférieur au prix de vente configuré (${floor}).` };
  }
  return { ok: true };
}

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

function run(): void {
  const FLOOR = 15000;

  // 1. Sans permission, prix normal (= floor) -- autorisé.
  expect(checkPrice(15000, FLOOR, false).ok, "Sans permission, le prix exact du catalogue doit être accepté.");

  // 2. Sans permission, hausse -- autorisé (jamais restreint, avec ou sans permission).
  expect(checkPrice(15500, FLOOR, false).ok, "Sans permission, une hausse doit être acceptée.");
  expect(checkPrice(17000, FLOOR, false).ok, "Sans permission, une forte hausse doit être acceptée.");

  // 3. Sans permission, baisse -- refusé.
  expect(!checkPrice(14999, FLOOR, false).ok, "Sans permission, 14999 (< 15000) doit être refusé.");
  expect(!checkPrice(14000, FLOOR, false).ok, "Sans permission, 14000 doit être refusé.");
  expect(!checkPrice(10000, FLOOR, false).ok, "Sans permission, 10000 doit être refusé.");

  // 4. Avec permission, hausse -- autorisé.
  expect(checkPrice(17000, FLOOR, true).ok, "Avec permission, une hausse doit être acceptée.");

  // 5. Avec permission, baisse -- autorisé (c'est exactement le but de la permission).
  expect(checkPrice(15000, FLOOR, true).ok, "Avec permission, le prix exact doit rester accepté.");
  expect(checkPrice(14500, FLOOR, true).ok, "Avec permission, 14500 (< floor) doit être accepté.");
  expect(checkPrice(12000, FLOOR, true).ok, "Avec permission, 12000 (< floor) doit être accepté.");

  // 6. Prix = 0 -- toujours refusé, avec ou sans permission (absolu).
  expect(!checkPrice(0, FLOOR, false).ok, "Prix = 0 doit toujours être refusé sans permission.");
  expect(!checkPrice(0, FLOOR, true).ok, "Prix = 0 doit toujours être refusé même avec permission.");
  expect(!checkPrice(0, null, true).ok, "Prix = 0 doit être refusé même pour un article sans plancher catalogue.");

  // 7. Prix négatif -- toujours refusé, avec ou sans permission.
  expect(!checkPrice(-100, FLOOR, false).ok, "Prix négatif doit toujours être refusé sans permission.");
  expect(!checkPrice(-100, FLOOR, true).ok, "Prix négatif doit toujours être refusé même avec permission.");

  // Article sans prix catalogue configuré (floor = null) : aucune borne à
  // vérifier, n'importe quel prix strictement positif passe (avec ou sans
  // permission -- la permission ne change rien puisqu'il n'y a rien à outrepasser).
  expect(checkPrice(1, null, false).ok, "Sans plancher catalogue, tout prix positif doit être accepté.");

  console.log("Commerce sales price-override tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
