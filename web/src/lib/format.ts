const eurFmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
export const eur = (n: number | null | undefined) => (n == null || Number.isNaN(Number(n)) ? "—" : eurFmt.format(Number(n)));
export const num = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("es-ES").format(n));
export const date = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("es-ES") : "—");
export const dateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export function ago(d: string | null | undefined) {
  if (!d) return "—";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) return `hace ${Math.floor(s / 86400)} d`;
  return date(d);
}
export const ms = (n: number | null | undefined) => (n == null ? "—" : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);
