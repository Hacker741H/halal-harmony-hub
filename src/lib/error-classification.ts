/**
 * P1-2 (audit de stabilisation) : classificateur d'erreurs partagé.
 *
 * Contrainte dure, vérifiée dans le code du framework (seroval
 * ShallowErrorPlugin) : seul `error.message` traverse la frontière
 * serveur -> client d'un server function TanStack Start. `.code`,
 * `.details`, la sous-classe d'erreur -- tout est perdu. Toute
 * classification doit donc fonctionner à partir du texte du message seul,
 * jamais de `error.code` (voir commerce-pos-sync.ts, la fonction que ce
 * fichier remplace : elle lisait `error.code`, toujours `undefined` en
 * pratique, ce qui faisait qu'aucune erreur n'était jamais marquée comme
 * définitive).
 *
 * Fiabilité par catégorie, vérifiée avant d'écrire ce fichier :
 * - "network" exige la forme ET le message : un TypeError seul ne suffit
 *   plus (un bug JS -- "Cannot read properties of undefined" -- est aussi
 *   un TypeError sans être une panne de transport). Le message doit
 *   corroborer une vraie panne ("Failed to fetch", "NetworkError", etc.).
 * - "session" est un signal fiable (préfixe unique, un seul producteur,
 *   requireSupabaseAuth).
 * - "permission" / "validation" / "business" sont des heuristiques par
 *   mot-clé, vérifiées contre le texte réel des RAISE EXCEPTION des 154
 *   migrations (grep sur ERRCODE 42501/22023/23514) -- de bonne confiance
 *   mais pas garanties à 100%, puisque le code Postgres qui les
 *   distinguait proprement ne survit pas au transport. "business" est
 *   volontairement ÉTROIT (vocabulaire de fonds/stock/conflit d'état
 *   observé dans le corpus réel) -- ce n'est PAS le repli universel : un
 *   message métier réel non couvert par ce vocabulaire tombe dans
 *   "server" plutôt que d'être faussement rattaché à "business".
 * - "server" est le repli final : valeur lancée sans message exploitable,
 *   OU message réel qui ne correspond à aucune catégorie reconnue
 *   (bug JS inattendu, erreur générique, message métier non couvert).
 *
 * Cette imprécision entre permission/validation/business/server n'affecte
 * aucune décision retryable/non-retryable (voir isRetryableCategory) :
 * seul "network" est retenté. Elle affecte seulement le texte qu'un futur
 * point d'affichage pourrait choisir de montrer par catégorie.
 */

export type ErrorCategory = "network" | "session" | "permission" | "validation" | "business" | "server";

// Correction (2e passe) : la forme SEULE ne suffit plus. L'ancienne
// isLikelyNetworkError de router.tsx traitait tout TypeError comme réseau
// -- mais un TypeError peut tout autant venir d'un bug JS ordinaire
// ("Cannot read properties of undefined (reading 'x')") que d'un fetch()
// qui n'a jamais atteint de réponse. On exige maintenant les deux : le
// type ET un message qui corrobore réellement une panne de transport.
function looksLikeNetworkError(message: string, isTypeError: boolean): boolean {
  return isTypeError && /fetch|network|ECONNRESET|ETIMEDOUT/i.test(message);
}

// requireSupabaseAuth (src/integrations/supabase/auth-middleware.ts) est
// l'unique producteur de messages "Unauthorized: ...". Certaines RPC
// ajoutent en plus, en défense en profondeur, leurs propres messages
// "Authentification requise..." (voir supabase/migrations, ERRCODE 42501)
// -- sémantiquement la même catégorie, même si auth.uid() y est nul pour
// une raison différente d'un JWT absent/expiré.
function looksLikeSessionError(message: string): boolean {
  return message.startsWith("Unauthorized") || /authentification requise/i.test(message);
}

// Vérifié contre le corpus réel (RAISE EXCEPTION ... ERRCODE 42501) :
// "n'avez pas la permission", "non autorisé(e)", "accès/acces refusé",
// "réservé au", "seul un administrateur/super administrateur peut" en
// couvrent la grande majorité sans jamais recouper le vocabulaire observé
// pour "validation"/"business" (22023/23514).
function looksLikePermissionError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("permission") ||
    m.includes("autoris") || // autorisé, autorisée, non autorisé, autorisation
    m.includes("refus") || // refusé, refuse
    m.includes("réservé") ||
    m.includes("reserve") ||
    m.includes("administrateur")
  );
}

// Vérifié contre le corpus réel (ERRCODE 22023, sous-ensemble "champ
// manquant/invalide" plutôt que "état métier incompatible") : ces messages
// se reconnaissent par un vocabulaire de champ, pas de règle métier.
function looksLikeValidationError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("invalide") ||
    m.includes("obligatoire") ||
    m.includes("est requis") ||
    m.includes("sont requis") ||
    m.includes("manquant")
  );
}

// Vérifié contre le corpus réel (RAISE EXCEPTION métier, ERRCODE 22023/
// 23514 côté conflit d'état plutôt que côté champ) : vocabulaire de
// fonds/stock/état qui revient dans les messages métier réels de ce
// projet -- "Solde insuffisant...", "Cet ajustement rendrait le stock
// négatif.", "Ce rapport est deja solde...", "Cette affectation est déjà
// clôturée/retirée.". Les deux graphies (accentuée et non, observées
// telles quelles dans des migrations différentes) sont couvertes.
// Volontairement étroit -- voir le commentaire d'en-tête du fichier.
function looksLikeBusinessError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("solde") ||
    m.includes("insuffisant") ||
    m.includes("négatif") ||
    m.includes("negatif") ||
    m.includes("déjà") ||
    m.includes("deja")
  );
}

/**
 * Classe une erreur telle qu'elle arrive réellement côté client (après le
 * passage par un server function TanStack Start, ou une erreur JS locale
 * comme un TypeError réseau). Ne dépend jamais de `error.code`.
 */
export function classifyError(error: unknown): ErrorCategory {
  const isTypeError = error instanceof TypeError;
  const message = getErrorMessage(error);
  if (looksLikeNetworkError(message, isTypeError)) return "network";
  if (looksLikeSessionError(message)) return "session";
  if (looksLikePermissionError(message)) return "permission";
  if (looksLikeValidationError(message)) return "validation";
  if (looksLikeBusinessError(message)) return "business";
  // Repli final : message vide (forme non reconnue -- objet vide, chaîne
  // brute, null) ou message réel qui ne correspond à aucune catégorie
  // reconnue (bug JS, erreur générique). Les vérifications ci-dessus sont
  // de simples tests de sous-chaîne sur `message` : une chaîne vide les
  // échoue toutes naturellement, donc aucun cas particulier séparé n'est
  // nécessaire pour ce sous-cas.
  return "server";
}

/**
 * Seul "network" mérite une nouvelle tentative automatique. Les cinq
 * autres catégories sont définitives : rejouer la même requête produira
 * la même erreur, puisque rien côté réseau n'a changé.
 */
export function isRetryableCategory(category: ErrorCategory): boolean {
  return category === "network";
}

/**
 * Extraction de message tolérante, utilisée par classifyError() et par
 * tout appelant qui a seulement besoin d'un texte à afficher/logger --
 * gère une vraie Error, un objet simple avec .message (forme que prend
 * parfois une erreur désérialisée), ou une valeur lancée qui n'est ni
 * l'un ni l'autre.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "";
}
