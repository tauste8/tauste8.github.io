import { AlertTriangle, CheckCircle2, Info, Search as SearchIcon, X, XCircle } from "lucide-react";
import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { CompatStatus } from "../lib/types";

// ───────── Botón ─────────
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "default";
  size?: "sm" | "lg";
  icon?: ReactNode;
  loading?: boolean;
  iconOnly?: boolean;
};
export function Button({ variant = "default", size, icon, loading, iconOnly, children, className = "", disabled, ...rest }: BtnProps) {
  const cls = ["btn", variant !== "default" && `btn-${variant}`, size && `btn-${size}`, iconOnly && "btn-icon", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : icon}
      {children}
    </button>
  );
}

// ───────── Formularios ─────────
export function Field({ label, hint, children, className = "", plain }: { label?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; plain?: boolean }) {
  const autoId = useId();
  // Un único control (input/select/textarea): se asocia con htmlFor/id. Si el control va dentro de un
  // contenedor, la etiqueta lo envuelve. En ambos casos la ayuda queda fuera del nombre accesible.
  const single = isValidElement(children) && typeof children.type === "string" && ["input", "select", "textarea"].includes(children.type);
  if (single) {
    const el = children as ReactElement<{ id?: string }>;
    const id = el.props.id ?? autoId;
    return (
      <div className={`field ${className}`}>
        {label && <label className="field-label" htmlFor={id}>{label}</label>}
        {cloneElement(el, { id })}
        {hint && <span className="hint">{hint}</span>}
      </div>
    );
  }
  const Inner = plain ? "div" : "label";
  return (
    <div className={`field ${className}`}>
      <Inner className="field-main">
        {label && <span className="field-label">{label}</span>}
        {children}
      </Inner>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = "Buscar…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <SearchIcon size={16} />
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

// ───────── Tarjeta / cabecera ─────────
export function Card({ title, actions, children, className = "", pad = true, icon }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; icon?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <h3>{icon}{title}</h3>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {pad ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

export function PageHead({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" style={{ padding: 16 }} aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 38, opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="alert alert-red" role="alert">
      <XCircle size={18} />
      <div>{(error as Error).message ?? String(error)}</div>
    </div>
  );
}

export function Alert({ tone = "blue", children, icon }: { tone?: "blue" | "amber" | "red" | "lime"; children: ReactNode; icon?: ReactNode }) {
  const I = tone === "amber" ? AlertTriangle : tone === "red" ? XCircle : tone === "lime" ? CheckCircle2 : Info;
  return (
    <div className={`alert alert-${tone}`}>
      {icon ?? <I size={18} />}
      <div className="grow">{children}</div>
    </div>
  );
}

// ───────── Badges ─────────
export function Badge({ tone, children, dot }: { tone?: "lime" | "amber" | "red" | "blue"; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge ${tone ? `badge-${tone}` : ""}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export const COMPAT_LABEL: Record<CompatStatus, string> = {
  confirmada: "Compatibilidad confirmada",
  pendiente: "Pendiente de verificar",
  no_compatible: "No compatible",
};
export function CompatBadge({ status, short }: { status: CompatStatus; short?: boolean }) {
  const tone = status === "confirmada" ? "lime" : status === "pendiente" ? "amber" : "red";
  const I = status === "confirmada" ? CheckCircle2 : status === "pendiente" ? AlertTriangle : XCircle;
  return (
    <span className={`badge badge-${tone}`}>
      <I size={12} />
      {short ? (status === "confirmada" ? "Confirmada" : status === "pendiente" ? "Pendiente" : "No compatible") : COMPAT_LABEL[status]}
    </span>
  );
}

const STATUS_TONES: Record<string, "lime" | "amber" | "red" | "blue" | undefined> = {
  borrador: undefined, enviado: "blue", aceptado: "lime", rechazado: "red", convertido: "lime",
  pendiente: "amber", solicitado_proveedor: "blue", recibido: "blue", entregado: "lime", cancelado: "red",
  completado: "lime", sin_resultados: "red", requiere_vehiculo: "amber", requiere_pieza: "amber",
  activo: "lime", no_conectado: undefined, sin_datos: "amber", error: "red", desactivado: undefined,
};
const STATUS_LABEL: Record<string, string> = {
  borrador: "Borrador", enviado: "Enviado", aceptado: "Aceptado", rechazado: "Rechazado", convertido: "Convertido en pedido",
  pendiente: "Pendiente", solicitado_proveedor: "Solicitado a proveedor", recibido: "Recibido", entregado: "Entregado", cancelado: "Cancelado",
  completado: "Con resultados", sin_resultados: "Sin resultados", requiere_vehiculo: "Falta vehículo", requiere_pieza: "Falta pieza",
  activo: "Activo", no_conectado: "No conectado", sin_datos: "Sin datos", error: "Error", desactivado: "Desactivado",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status]} dot>{STATUS_LABEL[status] ?? status}</Badge>;
}
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

// ───────── Modal ─────────
export function Modal({ title, onClose, children, footer, size }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "wide" | "narrow" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ""}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <Button variant="ghost" iconOnly size="sm" onClick={onClose} aria-label="Cerrar" icon={<X size={18} />} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, message, confirmLabel = "Confirmar", danger, onConfirm, onClose }: {
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<unknown> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Modal title={title} onClose={onClose} size="narrow" footer={
      <>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={async () => {
          setBusy(true);
          setErr(null);
          try { await onConfirm(); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); }
        }}>{confirmLabel}</Button>
      </>
    }>
      <div className="stack">
        <div className="muted">{message}</div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

// ───────── Toasts ─────────
interface ToastItem { id: number; kind: "ok" | "err"; text: string }
const ToastCtx = createContext<(kind: "ok" | "err", text: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: "ok" | "err", text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "err" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "ok" ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            <div>{t.text}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  const push = useContext(ToastCtx);
  return { ok: (t: string) => push("ok", t), err: (e: unknown) => push("err", (e as Error)?.message ?? String(e)) };
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button key={i.value} role="tab" aria-selected={value === i.value} className={`tab ${value === i.value ? "active" : ""}`} onClick={() => onChange(i.value)}>
          {i.label}
          {i.count !== undefined && <span className="count">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ label, value, sub, icon }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{icon}{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
