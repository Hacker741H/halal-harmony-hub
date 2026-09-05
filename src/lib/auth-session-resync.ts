/**
 * Bug global (retour de focus/minimisation) : supabase-js re-emet couramment
 * un evenement SIGNED_IN quand la visibilite de l'onglet revient, meme pour
 * un utilisateur deja connecte dont le token a simplement ete rafraichi --
 * pas seulement lors d'une vraie nouvelle connexion. Traiter les deux
 * identiquement (purge totale du cache + invalidation du routeur) demonte
 * tout le sous-arbre authentifie a chaque minimisation, perdant au passage
 * tout etat local (onglet caisse/gestion, rapport ouvert, etc.).
 *
 * Cette fonction isole la seule decision qui compte : faut-il une resynchro
 * complete, ou seulement rafraichir l'identite affichee ? Comparer les
 * identifiants utilisateur plutot que de se fier au nom de l'evenement seul.
 */
export function shouldSkipFullSessionResync(
  event: string,
  previousUserId: string | null,
  nextUserId: string | null,
): boolean {
  return event === "SIGNED_IN" && nextUserId !== null && nextUserId === previousUserId;
}

/**
 * A plain TOKEN_REFRESHED (or any other Supabase auth event outside this
 * list) never changes who is signed in, so it must never trigger a cache
 * purge or router invalidation on its own -- only SIGNED_IN/SIGNED_OUT/
 * USER_UPDATED are even candidates for a resync decision.
 */
export function isRelevantAuthEvent(event: string): boolean {
  return event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED";
}

/**
 * P0-1 (stabilisation audit) : Supabase emet le meme evenement SIGNED_OUT
 * que la deconnexion vienne d'un clic volontaire ou du SDK decouvrant tout
 * seul que son refresh token n'est plus valide (revoque, expire apres une
 * longue periode d'inactivite, compte desactive par un admin en cours de
 * service) -- rien dans le nom de l'evenement ne distingue les deux cas.
 *
 * Avant, aucune des trois couches d'authentification ne reagissait a ce
 * second cas : useSession() videait juste le cache sans jamais naviguer,
 * et le garde de _authenticated/route.tsx ne s'execute qu'une fois au
 * montage. Chaque requete suivante echouait avec un message prefixe
 * "Unauthorized:", que router.tsx supprime deliberement (pour ne pas
 * afficher un toast pendant une deconnexion volontaire normale) -- laissant
 * l'utilisateur sur un ecran mort, sans le moindre indice.
 *
 * Le seul signal fiable est temporel : marquer l'instant juste avant que
 * *notre propre* code appelle supabase.auth.signOut(), et consommer cette
 * marque des que le SIGNED_OUT qui en resulte arrive. Un SIGNED_OUT qui
 * arrive sans marque fraiche n'a pas ete demande par l'application.
 */
let voluntarySignOutRequested = false;

/** A appeler juste avant tout appel volontaire a supabase.auth.signOut(). */
export function markVoluntarySignOut(): void {
  voluntarySignOutRequested = true;
}

/**
 * A appeler une seule fois par evenement SIGNED_OUT recu. Consomme la
 * marque (la remet a false) pour que l'etat ne reste jamais "coince" a
 * true apres une premiere consommation.
 */
export function consumeVoluntarySignOutFlag(): boolean {
  const wasVoluntary = voluntarySignOutRequested;
  voluntarySignOutRequested = false;
  return wasVoluntary;
}

/**
 * Decision pure, testable isolement : un SIGNED_OUT doit renvoyer vers
 * /auth avec un message explicite seulement quand rien dans l'app n'a
 * demande cette deconnexion. Les deux points d'appel volontaires
 * (__root.tsx, commerce-pos-workspace.tsx) naviguent deja eux-memes juste
 * apres leur propre appel a signOut() -- rediriger a nouveau ici serait au
 * mieux redondant, au pire un faux message "session expiree" affiche a un
 * utilisateur qui vient de se deconnecter lui-meme.
 */
export function shouldRedirectOnSignOut(event: string, wasVoluntary: boolean): boolean {
  return event === "SIGNED_OUT" && !wasVoluntary;
}
