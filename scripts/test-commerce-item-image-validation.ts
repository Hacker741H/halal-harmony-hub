// REFONTE CAISSE + IMAGE ARTICLE : mirroir (pas import, même convention que
// les autres scripts de ce dossier) de validateCommerceItemImageFile
// (src/components/commerce/commerce-item-image.tsx) -- si les règles y
// changent sans que ce mirroir change (ou l'inverse), relire les deux côte
// à côte avant de faire confiance à ce test.
import assert from "node:assert/strict";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function validateCommerceItemImageFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Formats acceptés : JPEG, PNG ou WebP.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "Image trop lourde (5 Mo maximum).";
  }
  return null;
}

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

function run(): void {
  // 1. Les 3 formats explicitement autorisés (section 9 de la demande),
  // sous la limite de taille, doivent tous passer.
  for (const type of ALLOWED_TYPES) {
    expect(
      validateCommerceItemImageFile({ type, size: 1024 }) === null,
      `${type} sous 5 Mo doit être accepté sans erreur.`,
    );
  }

  // 2. Un format hors-liste (ex. GIF, PDF, SVG) doit toujours être rejeté,
  // quelle que soit sa taille.
  expect(
    validateCommerceItemImageFile({ type: "image/gif", size: 100 }) !== null,
    "image/gif doit être rejeté -- seuls JPEG/PNG/WebP sont autorisés.",
  );
  expect(
    validateCommerceItemImageFile({ type: "application/pdf", size: 100 }) !== null,
    "application/pdf doit être rejeté.",
  );

  // 3. Limite de taille : exactement 5 Mo passe, 5 Mo + 1 octet est rejeté
  // -- aligné avec file_size_limit du bucket Storage commerce-item-images
  // (migration 20260908100000), pour qu'un fichier accepté côté client ne
  // soit jamais ensuite silencieusement refusé par le bucket.
  expect(
    validateCommerceItemImageFile({ type: "image/png", size: 5 * 1024 * 1024 }) === null,
    "exactement 5 Mo doit encore être accepté (limite inclusive).",
  );
  expect(
    validateCommerceItemImageFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 }) !== null,
    "5 Mo + 1 octet doit être rejeté.",
  );

  console.log("Commerce item image validation tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
