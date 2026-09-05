// Formatting helpers — French locale, XOF currency (FCFA).

const nfNumber = new Intl.NumberFormat("fr-FR");
const nfMoney = new Intl.NumberFormat("fr-FR", {
  style: "decimal",
  maximumFractionDigits: 0,
});

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return nfNumber.format(value);
}

export function formatXOF(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${nfMoney.format(Math.round(value))} FCFA`;
}

export function formatXOFCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(".", ",")} Mds FCFA`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")} M FCFA`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)} k FCFA`;
  return `${nfMoney.format(Math.round(value))} FCFA`;
}

// Une chaîne "YYYY-MM-DD" seule (une date sans heure -- date_recolte,
// sale_date, planned_date, etc.) est interprétée par `new Date(string)`
// comme minuit UTC, puis affichée dans le fuseau local -- ce qui recule
// d'un jour hors UTC+0. Plusieurs écrans contournaient déjà ça à la main
// (ajout de "T00:00:00" avant parsing, trouvé indépendamment dans au moins
// 7 fichiers) ; corrigé une fois ici pour que tout le monde en profite,
// plutôt que de laisser chaque appelant réinventer le même contournement.
// Sans effet sur un timestamp complet (created_at, closed_at, etc.) : la
// regex n'accepte que la forme exacte à 10 caractères.
function parseDateValue(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? parseDateValue(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? parseDateValue(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Style "medium + heure courte" (ex. "4 sept. 2026, 14:30"), distinct du
// format compact ci-dessus -- trouvé identique, copié-collé mot pour mot,
// dans 5 fichiers Commerce/Stock avant ce nettoyage (inventory-counts-panel,
// stock-transfers-panel, leurs pages détail, operational-course-workspace).
// Centralisé ici pour que ces 5 écrans partagent une seule implémentation
// au lieu de cinq copies identiques, sans changer leur rendu visible.
export function formatDateTimeMedium(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? parseDateValue(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

export function relativeFromNow(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? parseDateValue(value) : value;
  const diffMs = d.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  if (diffDays === 0) return "aujourd'hui";
  if (diffDays > 0) return `dans ${diffDays} jour${diffDays > 1 ? "s" : ""}`;
  return `il y a ${-diffDays} jour${-diffDays > 1 ? "s" : ""}`;
}
