export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { "X-Requested-With": "autoreca" } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${url}`, init);
  } catch {
    throw new ApiError(0, "Sin conexión con el servidor. Compruebe la red.");
  }
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/auth/")) window.dispatchEvent(new Event("autoreca:unauthorized"));
    let msg = data?.error ?? `Error ${res.status}`;
    if (Array.isArray(data?.details) && data.details.length && data.details[0]?.mensaje) {
      msg += ": " + data.details.map((d: { campo: string; mensaje: string }) => (d.campo ? `${d.campo} — ${d.mensaje}` : d.mensaje)).join("; ");
    }
    throw new ApiError(res.status, msg, data?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body: unknown) => request<T>("PATCH", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

export function qs(params: Record<string, string | number | undefined | null | boolean>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
