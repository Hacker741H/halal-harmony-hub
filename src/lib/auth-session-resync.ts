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
