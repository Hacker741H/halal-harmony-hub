// Bug production (article transféré "indisponible" en Caisse) : un article
// reçu pour la première fois via un transfert de stock (receive_commerce_
// stock_transfer) n'a jamais de sale_price défini -- cette information
// n'existe simplement pas au moment du transfert, ce n'est pas un bug SQL.
// Le vrai bug vivait côté Caisse : addArticle() acceptait silencieusement
// `unitPrice: defaultPrice ?? 0`, vendant l'article à 0 FCFA sans le
// moindre avertissement -- alors que le stock était bien présent (quantité
// positive confirmée en production sur plusieurs articles réels).
//
// Ce script mirrore littéralement les deux décisions maintenant partagées
// par les trois points d'entrée d'addArticle (bouton grille, recherche
// rapide, événement clavier/scan externe) dans
// src/components/commerce/commerce-pos-workspace.tsx : le calcul de
// outOfStock/needsPrice pour l'affichage de la grille, et le garde-fou
// dans addArticle lui-même qui empêche désormais toute vente silencieuse
// à 0 FCFA ou en rupture de stock.
import assert from "node:assert/strict";

function expect(condition: unknown, message: string): asserts condition {
  assert.equal(condition, true, message);
}

type CatalogueItem = { quantity: number; salePrice: number | null };

// Mirroir de la classification de src/components/commerce/commerce-pos-
// workspace.tsx (rendu de la grille) : deux états distincts, jamais
// confondus -- un stock positif sans prix défini n'est jamais une rupture.
function classify(item: CatalogueItem): { outOfStock: boolean; needsPrice: boolean } {
  const outOfStock = item.quantity <= 0;
  const needsPrice = !outOfStock && item.salePrice === null;
  return { outOfStock, needsPrice };
}

// Mirroir du garde-fou dans addArticle : renvoie le résultat qui serait
// produit (une ligne ajoutée avec le vrai prix, ou un rejet explicite --
// jamais un ajout silencieux à 0 FCFA).
function attemptAddArticle(item: CatalogueItem): { added: true; unitPrice: number } | { added: false; reason: "OUT_OF_STOCK" | "NEEDS_PRICE" } {
  if (item.quantity <= 0) return { added: false, reason: "OUT_OF_STOCK" };
  if (item.salePrice === null) return { added: false, reason: "NEEDS_PRICE" };
  return { added: true, unitPrice: item.salePrice };
}

function run(): void {
  // 1. Le cas réel trouvé en production : un article transféré pour la
  // première fois dans un magasin (quantité positive confirmée, ex. 1, 2,
  // 5 pièces), sale_price jamais défini à ce magasin. Doit être classé
  // "prix à définir", JAMAIS "rupture".
  expect(
    classify({ quantity: 1, salePrice: null }).outOfStock === false,
    "Un article avec quantité=1 ne doit jamais être classé en rupture, même sans prix de vente défini.",
  );
  expect(
    classify({ quantity: 1, salePrice: null }).needsPrice === true,
    "Un article avec quantité positive et salePrice=null doit être classé 'prix à définir'.",
  );

  // 2. Le cas de comparaison exact du rapport (« Sac eastpak ») : quantité
  // positive ET prix de vente réel -- ni rupture, ni prix à définir.
  const eastpak = classify({ quantity: 3, salePrice: 9000 });
  expect(eastpak.outOfStock === false && eastpak.needsPrice === false, "Un article avec quantité positive et un prix de vente réel n'est ni en rupture ni 'prix à définir'.");

  // 3. Une vraie rupture (quantité nulle ou négative) reste 'Rupture',
  // jamais confondue avec 'prix à définir', même si le prix est aussi absent.
  expect(classify({ quantity: 0, salePrice: null }).outOfStock === true, "quantity=0 doit être classé en rupture.");
  expect(classify({ quantity: 0, salePrice: null }).needsPrice === false, "Une vraie rupture ne doit jamais être aussi classée 'prix à définir' -- un seul état affiché à la fois.");
  expect(classify({ quantity: 0, salePrice: 9000 }).outOfStock === true, "Un prix de vente réel ne rend jamais un article disponible si la quantité réelle est nulle ou négative.");

  // 4. Le garde-fou d'addArticle -- jamais d'ajout silencieux à 0 FCFA ni
  // en rupture, quel que soit le point d'entrée (bouton, recherche rapide,
  // événement externe) : c'est la même fonction pour les trois.
  const rejectedForPrice = attemptAddArticle({ quantity: 1, salePrice: null });
  expect(rejectedForPrice.added === false && rejectedForPrice.reason === "NEEDS_PRICE", "addArticle doit rejeter explicitement un article sans prix de vente, jamais l'ajouter à 0 FCFA.");

  const rejectedForStock = attemptAddArticle({ quantity: 0, salePrice: 9000 });
  expect(rejectedForStock.added === false && rejectedForStock.reason === "OUT_OF_STOCK", "addArticle doit rejeter explicitement un article en rupture, même s'il a un prix de vente réel.");

  const accepted = attemptAddArticle({ quantity: 3, salePrice: 9000 });
  expect(accepted.added === true && accepted.unitPrice === 9000, "addArticle doit accepter un article avec stock positif et prix de vente réel, au vrai prix catalogue -- jamais 0.");

  console.log("POS catalogue availability tests passed.");
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
