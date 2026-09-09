// SÉPARATION NOM APPLICATION / NOM ENTREPRISE : mirroir (pas import, même
// convention que les autres scripts de ce dossier -- voir
// test-commerce-item-image-validation.ts) de resolveCompanyName
// (src/hooks/use-company-settings.ts) -- garantit que le nom de
// l'entreprise (public.company_settings.nom) a toujours une valeur
// affichable, et que le repli "HALAL & CO" s'applique bien à chaque forme
// d'absence de donnée (ligne manquante, colonne null, chaîne vide ou
// uniquement des espaces). Si l'implémentation réelle change sans que ce
// mirroir change (ou l'inverse), relire les deux côte à côte avant de
// faire confiance à ce test.
import assert from "node:assert/strict";

const COMPANY_NAME_FALLBACK = "HALAL & CO";

function resolveCompanyName(nom: string | null | undefined): string {
  return nom?.trim() || COMPANY_NAME_FALLBACK;
}

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

function run(): void {
  // 1. Cas nominal -- le nom réel de l'entreprise en base est utilisé tel quel.
  expect(resolveCompanyName("HALAL & CO") === "HALAL & CO", "Un nom valide doit être renvoyé tel quel.");
  expect(resolveCompanyName("Autre Société SARL") === "Autre Société SARL", "Un autre nom valide doit être renvoyé tel quel.");

  // 2. null / undefined -- ligne absente (requête échouée) ou colonne
  // absente du type -- ne doit jamais planter, jamais afficher "null"/
  // "undefined" à l'écran.
  expect(resolveCompanyName(null) === COMPANY_NAME_FALLBACK, "null doit retomber sur le repli.");
  expect(resolveCompanyName(undefined) === COMPANY_NAME_FALLBACK, "undefined doit retomber sur le repli.");

  // 3. Chaîne vide ou uniquement des espaces -- colonne techniquement NOT
  // NULL mais vidée par erreur ne doit pas afficher une ligne blanche.
  expect(resolveCompanyName("") === COMPANY_NAME_FALLBACK, "Une chaîne vide doit retomber sur le repli.");
  expect(resolveCompanyName("   ") === COMPANY_NAME_FALLBACK, "Une chaîne uniquement composée d'espaces doit retomber sur le repli.");

  // 4. Espaces superflus autour d'un vrai nom -- nettoyés, pas juste
  // acceptés tels quels.
  expect(resolveCompanyName("  HALAL & CO  ") === "HALAL & CO", "Les espaces superflus doivent être retirés.");

  console.log("Company name fallback tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
