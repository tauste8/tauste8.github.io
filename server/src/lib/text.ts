/** Normaliza una referencia de recambio: solo A-Z y 0-9 (quita espacios, puntos, guiones…). */
export function normRef(v: string | null | undefined): string {
  return (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Texto en minúsculas, sin tildes ni signos, con espacios simples. */
export function normText(v: string | null | undefined): string {
  return (v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function emptyToNull<T>(v: T): T | null {
  return v === "" || v === undefined ? null : v;
}
