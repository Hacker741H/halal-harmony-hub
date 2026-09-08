// Stabilisation audit, P1-2 + P1-1 -- targeted automated tests for the
// shared error classifier (src/lib/error-classification.ts) and for its
// one real-world consumer fixed by this same pass, commerce-pos-sync.ts's
// getErrorDetails(). Message samples for the permission/validation/business
// cases are copied verbatim from actual RAISE EXCEPTION text found in
// supabase/migrations (grepped before writing the classifier), not
// invented, so these tests exercise the real vocabulary the classifier has
// to work with in production, not a convenient made-up string.
import assert from "node:assert/strict";

import {
  classifyError,
  getErrorMessage,
  isRetryableCategory,
  isSessionExpiredError,
  SESSION_EXPIRED_MESSAGE,
  type ErrorCategory,
} from "../src/lib/error-classification";
import { getErrorDetails } from "../src/lib/commerce-pos-sync";

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

function run(): void {
  // 1. Network -> retryable. LOT P1 2nd fix: shape ALONE is no longer
  // enough -- a TypeError can just as well come from an ordinary JS bug as
  // from fetch() never reaching a response. Both shape AND message must
  // corroborate a genuine transport failure.
  expect(
    classifyError(new TypeError("Failed to fetch")) === "network",
    "A TypeError whose message corroborates a real fetch failure must classify as network.",
  );
  expect(
    classifyError(new TypeError("NetworkError when attempting to fetch resource.")) === "network",
    "Any transport-shaped TypeError message must stay network regardless of exact wording.",
  );
  expect(
    classifyError(new TypeError("Cannot read properties of undefined (reading 'x')")) !== "network",
    "A TypeError from an ordinary JS bug (not a fetch failure) must NOT classify as network just because of its type.",
  );
  expect(
    classifyError(new TypeError("Cannot read properties of undefined (reading 'x')")) === "server",
    "That JS-bug TypeError must fall through to server -- it matches none of the known message categories.",
  );
  expect(
    getErrorDetails(new TypeError("Cannot read properties of undefined (reading 'x')")).permanent === true,
    "A JS-bug TypeError reaching the POS sync must be definitive, never retried as if it were a network drop.",
  );
  expect(
    classifyError(new Error("network error")) !== "network",
    "A plain Error (not a TypeError) is never network now, even if its message contains the word 'network' -- shape is required too.",
  );
  expect(isRetryableCategory("network") === true, "network must be the only retryable category.");

  // 2. Session expirée/authentification -> définitive, jamais bouclée.
  // requireSupabaseAuth's exact prefix, plus an RPC-level defense-in-depth
  // message (real text from supabase/migrations, ERRCODE 42501).
  expect(
    classifyError(new Error("Unauthorized: No authorization header provided")) === "session",
    "The requireSupabaseAuth prefix must classify as session.",
  );
  expect(
    classifyError(new Error("Authentification requise pour clore une session de caisse.")) === "session",
    "An RPC-level 'authentification requise' message must also classify as session.",
  );
  expect(isRetryableCategory("session") === false, "session must never be retryable.");

  // 3. Permission -> définitive. Real text from supabase/migrations.
  expect(
    classifyError(new Error("Vous n'avez pas la permission d'effectuer cette action.")) === "permission",
    "permission_require()'s exact message must classify as permission.",
  );
  expect(
    classifyError(new Error("Accès refusé à ce magasin.")) === "permission",
    "An access-denial message must classify as permission.",
  );
  expect(isRetryableCategory("permission") === false, "permission must never be retryable.");

  // 4. Validation -> définitive. Real text (ERRCODE 22023, field-shaped).
  expect(
    classifyError(new Error("Article, quantité ou prix de vente invalide.")) === "validation",
    "A field-invalid message must classify as validation.",
  );
  expect(
    classifyError(new Error("Categorie, montant, echeance et description sont obligatoires.")) === "validation",
    "A required-fields message must classify as validation.",
  );
  expect(isRetryableCategory("validation") === false, "validation must never be retryable.");

  // 5. Métier -> définitive. Real text (ERRCODE 22023/23514, fund/stock/
  // state-conflict vocabulary). LOT P1 2nd fix: business is a NARROW,
  // positively-matched category now, not the universal fallback -- see
  // the "server" section below for a real-sounding message that must NOT
  // land here.
  expect(
    classifyError(new Error("Solde insuffisant. Disponible : 15 000 FCFA.")) === "business",
    "A fund-shortage message must classify as business.",
  );
  expect(
    classifyError(new Error("Cet ajustement rendrait le stock négatif.")) === "business",
    "A stock business-rule message must classify as business.",
  );
  expect(isRetryableCategory("business") === false, "business must never be retryable.");

  // 6. Serveur -> comportement serveur approprié : repli final pour une
  // valeur lancée qui n'est ni une Error ni un objet {message}, pour un
  // message vide, OU (LOT P1 2nd fix) pour un message réel qui ne
  // correspond à aucune catégorie connue -- jamais confondu avec "network"
  // faute de mieux, et jamais faussement rattaché à "business" juste parce
  // qu'il vient du serveur.
  expect(classifyError("boom") === "server", "A plain thrown string with no .message must classify as server.");
  expect(classifyError(undefined) === "server", "A thrown undefined must classify as server.");
  expect(classifyError(new Error("")) === "server", "An Error with an empty message must classify as server.");
  expect(
    classifyError(new Error("Erreur interne du serveur.")) === "server",
    "A generic real server-crash message must classify as server, not business -- business is reserved for known business-rule vocabulary.",
  );
  expect(isRetryableCategory("server") === false, "server must never be retryable.");

  // 7. Absence de error.code -> la classification reste correcte. C'est
  // exactement le bug corrigé : l'ancien code lisait error.code, qui ne
  // survit jamais au transport serveur -> client. Prouver que classifyError
  // produit le même résultat qu'un .code soit présent ou non sur la même
  // Error démontre qu'il n'y a plus aucune dépendance cachée dessus.
  const permissionError = new Error("Vous n'avez pas la permission d'effectuer cette action.");
  const sameMessageWithFakeCode = new Error("Vous n'avez pas la permission d'effectuer cette action.");
  (sameMessageWithFakeCode as unknown as { code: string }).code = "42501";
  expect(
    classifyError(permissionError) === classifyError(sameMessageWithFakeCode),
    "Attaching a .code must not change the classification -- only .message is ever read.",
  );
  expect(classifyError(sameMessageWithFakeCode) === "permission", "Classification by message text must still be correct with a .code present.");

  // 8. getErrorMessage : extraction tolérante utilisée par classifyError
  // et par tout futur appelant qui a seulement besoin d'un texte.
  expect(getErrorMessage(new Error("x")) === "x", "getErrorMessage must read .message off a real Error.");
  expect(getErrorMessage({ message: "y" }) === "y", "getErrorMessage must read .message off a plain object shape.");
  expect(getErrorMessage(42) === "", "getErrorMessage must return an empty string for an unrecognized shape.");

  // 9. Aucune régression du flux POS hors-ligne : getErrorDetails()
  // (le point corrigé pour P1-1) doit maintenant marquer une erreur
  // définitive comme permanent, et laisser une vraie erreur réseau
  // retentable -- exactement l'inverse du bug (permanent toujours false
  // parce que error.code n'existait jamais côté client).
  const permanentCase = getErrorDetails(new Error("Vous n'avez pas la permission d'effectuer cette action."));
  expect(permanentCase.permanent === true, "A permission rejection reaching the POS sync must now be marked permanent.");
  expect(permanentCase.message === "Vous n'avez pas la permission d'effectuer cette action.", "The message shown to the cashier must be the RPC's own text, unprefixed.");

  const networkCase = getErrorDetails(new TypeError("Failed to fetch"));
  expect(networkCase.permanent === false, "A genuine network failure in the POS sync must remain retryable.");

  const validationCase = getErrorDetails(new Error("Categorie, montant, echeance et description sont obligatoires."));
  expect(validationCase.permanent === true, "A validation rejection reaching the POS sync must be marked permanent.");

  const businessCase = getErrorDetails(new Error("Cet ajustement rendrait le stock négatif."));
  expect(businessCase.permanent === true, "A business-rule rejection reaching the POS sync must be marked permanent.");

  // 9b. Unrecognized/unexpected shapes -- LOT P1 follow-up fix. The final
  // rule is binary: only a genuinely identified "network" error is
  // retryable ; everything else, INCLUDING a shape nobody recognizes, must
  // be definitive so it can never loop forever. getErrorDetails() used to
  // special-case "no extractable message" to permanent: false, bypassing
  // the classifier entirely and silently contradicting this exact rule --
  // fixed to always derive `permanent` from classifyError()/
  // isRetryableCategory(), never from a hardcoded fallback. The display
  // message may still fall back to a friendly sentence ; the retry
  // decision must not.
  for (const [label, value] of [
    ["null", null],
    ["a raw string", "boom"],
    ["an empty object", {}],
  ] as const) {
    const result = getErrorDetails(value);
    expect(
      result.message === "Synchronisation indisponible. La vente reste dans la caisse locale.",
      `An unrecognized shape (${label}) must still get the friendly fallback message.`,
    );
    expect(
      result.permanent === true,
      `An unrecognized shape (${label}) must be marked permanent -- it must never be able to loop forever just because nothing matched.`,
    );
  }

  // 9c. Same concern, phrased at the getErrorDetails() level (the actual
  // POS consumer): a generic real server-crash message must be definitive
  // there too, not treated as a transport failure worth retrying.
  expect(
    getErrorDetails(new Error("Erreur interne du serveur.")).permanent === true,
    "A generic server-crash message reaching the POS sync must be definitive, not retried as if it were a transport failure.",
  );

  // 10. STABILISATION TRANSVERSALE (1/3) : isSessionExpiredError /
  // SESSION_EXPIRED_MESSAGE (consumed by src/lib/notify-mutation-error.ts,
  // the single replacement for the ~110 mutations that used to format
  // "Unauthorized: ..." themselves). isSessionExpiredError is a thin,
  // explicitly-named wrapper around classifyError(...) === "session" --
  // this guards it staying in lockstep with classifyError rather than
  // silently drifting into its own, independent (and possibly wrong)
  // definition of "session error" in some future edit.
  expect(
    isSessionExpiredError(new Error("Unauthorized: Invalid token")) === true,
    "isSessionExpiredError must agree with classifyError: the requireSupabaseAuth prefix is a session error.",
  );
  expect(
    isSessionExpiredError(new Error("Authentification requise pour clore une session de caisse.")) === true,
    "isSessionExpiredError must also catch the RPC-level defense-in-depth session message.",
  );
  expect(
    isSessionExpiredError(new Error("Vous n'avez pas la permission d'effectuer cette action.")) === false,
    "isSessionExpiredError must be false for a real permission error -- never masking a genuine business/permission rejection as a session expiry.",
  );
  expect(
    isSessionExpiredError(new Error("Solde insuffisant. Disponible : 15 000 FCFA.")) === false,
    "isSessionExpiredError must be false for a real business-rule error.",
  );
  expect(
    SESSION_EXPIRED_MESSAGE === "Votre session a expiré, reconnectez-vous.",
    "SESSION_EXPIRED_MESSAGE must stay the exact single source-of-truth string shown by __root.tsx and triggerSessionRecovery -- a silent change here would desynchronize the two.",
  );

  // Exhaustiveness guard: every category this file knows about must be
  // covered above -- if a new category is ever added to ErrorCategory
  // without updating this test, this line fails to compile.
  const _coverage: Record<ErrorCategory, true> = {
    network: true,
    session: true,
    permission: true,
    validation: true,
    business: true,
    server: true,
  };
  void _coverage;

  console.log("Error classification tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
