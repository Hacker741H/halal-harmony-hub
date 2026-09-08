/**
 * STABILISATION TRANSVERSALE (durcissement 1/3) : point d'entrée unique pour
 * l'affichage d'une erreur de mutation, remplaçant le pattern
 *   onError: (error) => toast.error(error instanceof Error ? error.message : "...")
 * répété (avec des variantes) sur une centaine de mutations à travers
 * l'app. Le remplacement est mécanique et préserve exactement le
 * comportement existant pour toute erreur non liée à la session -- seul le
 * cas "session expirée" change : plus jamais le message technique brut
 * ("Unauthorized: Invalid token") produit par requireSupabaseAuth
 * (src/integrations/supabase/auth-middleware.ts), qu'aucune mutation ne
 * doit jamais montrer tel quel.
 *
 * Ce fichier est délibérément séparé de error-classification.ts : ce
 * dernier reste pur (aucune dépendance à sonner ni au client Supabase),
 * ce qui compte puisqu'il est aussi importé par commerce-pos-sync.ts, un
 * module hors-UI (synchronisation différée) qui n'a besoin d'aucun des
 * deux. error-classification.ts reste la seule source de vérité pour LA
 * CLASSIFICATION ; ce fichier ne fait qu'agir dessus.
 */
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { isSessionExpiredError, SESSION_EXPIRED_MESSAGE } from "@/lib/error-classification";

// Un seul id sonner partagé avec __root.tsx (useSession, l'écouteur
// onAuthStateChange) : quelle que soit la première source à détecter la
// session morte -- ce fichier (dès qu'une mutation échoue) ou le SDK
// Supabase découvrant seul que son refresh token est mort -- le second
// toast.error(..., { id }) REMPLACE le premier au lieu de s'empiler dessus.
// C'est le mécanisme réel qui garantit "aucun double toast global + local",
// pas une coïncidence de timing.
const SESSION_EXPIRED_TOAST_ID = "session-expired";

// Une session ne meurt qu'une fois par épisode ; si 5 mutations échouent
// dans le même instant (un écran à plusieurs panneaux, chacun avec sa
// propre requête), une seule doit réellement déclencher signOut() -- les
// autres n'ont rien de plus à faire, le toast partagé et la redirection
// sont déjà en cours.
let sessionRecoveryInFlight = false;

/**
 * À appeler dès qu'une erreur de session est détectée, d'où que ce soit
 * (mutation, requête, gestionnaire global). Montre l'unique message ami
 * immédiatement (id partagé, jamais de doublon) puis force la reprise :
 * signOut({ scope: "local" }) efface la session locale et déclenche
 * SIGNED_OUT même quand le token est déjà invalide côté serveur (vérifié
 * dans @supabase/auth-js : les erreurs 401/403/404 de la révocation
 * serveur sont explicitement ignorées, _removeSession() s'exécute quand
 * même) -- l'écouteur déjà existant de __root.tsx (useSession) prend le
 * relais pour la redirection réelle vers /auth, exactement comme pour une
 * déconnexion involontaire (shouldRedirectOnSignOut ne distingue pas la
 * cause, seulement si CE code a lui-même appelé signOut() volontairement
 * via markVoluntarySignOut() -- jamais le cas ici).
 */
export function triggerSessionRecovery(): void {
  if (typeof window === "undefined") return;
  toast.error(SESSION_EXPIRED_MESSAGE, { id: SESSION_EXPIRED_TOAST_ID });
  if (sessionRecoveryInFlight) return;
  sessionRecoveryInFlight = true;
  void supabase.auth.signOut({ scope: "local" }).finally(() => {
    sessionRecoveryInFlight = false;
  });
}

/**
 * Le remplacement direct de `(error) => toast.error(error instanceof Error
 * ? error.message : fallback)`. Une session expirée ne montre plus jamais
 * son propre toast ici -- triggerSessionRecovery() a déjà montré le seul
 * message correct au même id. Tout le reste (permission/validation/
 * métier/réseau/serveur) montre exactement ce qu'il aurait montré avant :
 * aucune vraie erreur n'est masquée.
 */
export function notifyMutationError(error: unknown, fallback: string): void {
  if (isSessionExpiredError(error)) {
    triggerSessionRecovery();
    return;
  }
  toast.error(error instanceof Error ? error.message : fallback);
}
