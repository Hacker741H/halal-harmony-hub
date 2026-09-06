// Préflight production (audit read-only de iljetumzbqtrjvtdlynj) : la seule
// clôture réelle existante est closure_kind='AUTOMATIC', counted_cash=NULL
// (parcours automatique, pas encore compté). get_commerce_cash_remittance_
// workspace calculait remainingAmount avec
//   GREATEST(counted_cash - coalesce(used.amount, 0), 0)
// -- vérifié faux contre cette ligne réelle : Postgres ignore un argument
// NULL de GREATEST tant que l'autre est défini, donc le résultat retombe
// sur 0, jamais NULL. Une clôture jamais comptée s'affichait "0 FCFA
// restant", un signal identique à "entièrement remise".
//
// Correctif (20260906130000_remittance_workspace_null_safe_remaining_
// amount.sql) : NULL doit rester NULL, jamais silencieusement devenir 0.
// Ce script mirrore littéralement la nouvelle expression SQL
//   CASE WHEN counted_cash IS NULL THEN NULL ELSE GREATEST(counted_cash - used, 0) END
// -- si cette expression est un jour modifiée dans la migration sans
// modifier ce mirroir (ou l'inverse), relire les deux côte à côte pour
// confirmer qu'ils correspondent encore avant de faire confiance à ce test.
import assert from "node:assert/strict";

function remainingAmount(countedCash: number | null, usedAmount: number): number | null {
  if (countedCash === null) return null;
  return Math.max(countedCash - usedAmount, 0);
}

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

function run(): void {
  // 1. Le cas réel trouvé en production : clôture automatique jamais
  // comptée -- counted_cash NULL, aucune remise déjà rattachée (used=0).
  // Doit rester NULL, jamais 0.
  expect(
    remainingAmount(null, 0) === null,
    "counted_cash=NULL (clôture jamais comptée) doit produire remainingAmount=NULL, jamais 0 -- c'est exactement le bug trouvé en préflight.",
  );
  expect(
    remainingAmount(null, 5000) === null,
    "counted_cash=NULL reste NULL même si une remise partielle existe déjà pour cette clôture (used>0) -- le nombre inconnu ne devient jamais calculable a posteriori.",
  );

  // 2. counted_cash=0 est un VRAI zéro (le caissier a compté et il n'y
  // avait rien) -- à ne jamais confondre avec "inconnu". Doit rester 0,
  // un number, jamais NULL.
  expect(
    remainingAmount(0, 0) === 0,
    "counted_cash=0 (compté à zéro, une vraie valeur) doit produire remainingAmount=0, un number -- pas NULL.",
  );

  // 3. Montant positif normal, sans remise encore rattachée : le reste
  // est le montant compté en entier.
  expect(
    remainingAmount(15000, 0) === 15000,
    "counted_cash=15000, used=0 doit produire remainingAmount=15000.",
  );

  // 4. Montant positif avec une remise déjà partiellement rattachée :
  // le reste diminue d'autant, sans jamais devenir négatif (GREATEST(...,0)).
  expect(
    remainingAmount(15000, 13000) === 2000,
    "counted_cash=15000, used=13000 doit produire remainingAmount=2000 (l'écart de caisse du scénario métier de référence).",
  );
  expect(
    remainingAmount(15000, 15000) === 0,
    "counted_cash=15000, used=15000 (entièrement remis) doit produire remainingAmount=0.",
  );
  expect(
    remainingAmount(15000, 20000) === 0,
    "used > counted_cash ne doit jamais produire un reste négatif -- plafonné à 0 par GREATEST.",
  );

  console.log("Remittance remaining-amount tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
