import assert from "node:assert/strict";

import { shouldSkipFullSessionResync } from "../src/lib/auth-session-resync";

/**
 * Bug global (retour de focus) : useSession() ne doit purger le cache React
 * Query et invalider le routeur que sur un vrai changement d'identite --
 * jamais sur un SIGNED_IN de rafraichissement de token pour le meme
 * utilisateur (ce que supabase-js emet couramment au retour de visibilite
 * de l'onglet). Ce test isole exactement cette frontiere de decision.
 */
function run() {
  const USER_A = "user-aaaa-1111";
  const USER_B = "user-bbbb-2222";

  // Le cas reel du bug : meme utilisateur, token rafraichi au retour de
  // focus -- doit etre ignore (pas de purge, pas de remount).
  assert.equal(shouldSkipFullSessionResync("SIGNED_IN", USER_A, USER_A), true, "same user re-signed-in must skip the full resync");

  // Vraie premiere connexion (aucun utilisateur avant) -- ne doit jamais
  // etre ignoree.
  assert.equal(shouldSkipFullSessionResync("SIGNED_IN", null, USER_A), false, "a real login (no prior user) must never be skipped");

  // Changement d'identite reel (compte different) -- ne doit jamais etre
  // ignore, meme si l'evenement est SIGNED_IN.
  assert.equal(shouldSkipFullSessionResync("SIGNED_IN", USER_A, USER_B), false, "switching to a different user must never be skipped");

  // Deconnexion -- toujours traitee integralement, jamais un cas
  // "SIGNED_IN" donc jamais ignoree par construction.
  assert.equal(shouldSkipFullSessionResync("SIGNED_OUT", USER_A, null), false, "sign-out must never be skipped");

  // USER_UPDATED (changement de profil) -- toujours traite integralement,
  // meme pour le meme utilisateur : ce n'est pas le cas que cette fonction
  // est censee filtrer.
  assert.equal(shouldSkipFullSessionResync("USER_UPDATED", USER_A, USER_A), false, "USER_UPDATED must never be skipped, even for the same user");

  // Un SIGNED_IN "de rafraichissement" qui arriverait avec nextUserId=null
  // (ne devrait jamais arriver en pratique, mais la fonction ne doit pas le
  // traiter comme un skip valide -- garde defensive).
  assert.equal(shouldSkipFullSessionResync("SIGNED_IN", null, null), false, "a SIGNED_IN with no resolved user id must never be skipped");

  console.log(JSON.stringify({ passed: "AUTH_SESSION_RESYNC_TEST_PASSED", cases: 6 }));
}

run();
