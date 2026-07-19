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

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function relativeFromNow(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  const diffMs = d.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  if (diffDays === 0) return "aujourd'hui";
  if (diffDays > 0) return `dans ${diffDays} jour${diffDays > 1 ? "s" : ""}`;
  return `il y a ${-diffDays} jour${-diffDays > 1 ? "s" : ""}`;
}
