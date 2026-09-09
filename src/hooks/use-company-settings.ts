import { useQuery } from "@tanstack/react-query";

import { getCompanySettings, type CompanySettings } from "@/lib/company-settings.functions";

// SÉPARATION NOM APPLICATION / NOM ENTREPRISE (audit préalable, voir
// commit) : "HALAL ERP" reste le nom du logiciel, codé en dur à chaque
// endroit où il désigne le produit (sidebar, bandeau caisse, recherche,
// favicon/PWA, titres de pages...) -- volontairement inchangé.
// company_settings.nom est la seule source pour le nom de l'ENTREPRISE
// (l'organisation propriétaire/utilisatrice de l'app, ex. "HALAL & CO"),
// et ce hook est le point d'entrée partagé : aucun composant ne doit plus
// écrire sa propre requête `.from("company_settings")`.
//
// Fallback obligatoire : ligne absente, colonne vide/blanche, ou requête
// en erreur -> "HALAL & CO" (companyName reste toujours une chaîne
// affichable, jamais null/undefined/vide). L'échec du chargement ne
// bloque jamais l'app -- au pire le toast d'erreur global habituel
// (router.tsx, déjà réutilisé partout ailleurs) prévient silencieusement
// en fond, le texte affiché reste correct.
export const COMPANY_NAME_FALLBACK = "HALAL & CO";

/** Même règle de repli que useCompanySettings, exposée pour les rares
 * endroits (ex. alert-settings-panel.tsx) qui ont déjà la ligne
 * company_settings en main via une autre requête groupée existante et ne
 * doivent donc pas refaire un appel réseau juste pour le nom. */
export function resolveCompanyName(nom: string | null | undefined): string {
  return nom?.trim() || COMPANY_NAME_FALLBACK;
}

export function useCompanySettings() {
  const query = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => getCompanySettings(),
    // Change extrêmement rarement (une ligne singleton éditée par un
    // administrateur, pas une donnée opérationnelle) -- pas besoin de
    // revalider aussi souvent que le staleTime global de 10s.
    staleTime: 5 * 60_000,
  });

  const company: CompanySettings | null = query.data ?? null;

  return {
    ...query,
    company,
    companyName: resolveCompanyName(company?.nom),
    timezone: company?.timezone ?? null,
    currency: company?.devise ?? null,
    address: company?.adresse ?? null,
  };
}
