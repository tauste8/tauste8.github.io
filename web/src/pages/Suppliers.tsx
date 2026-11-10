import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ExternalLink, Mail, Pencil, Phone, Plug, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHead, SearchBox, StatusBadge, useDebounced, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ago, dateTime, eur } from "../lib/format";

export const SUPPLIER_TYPES: Record<string, string> = { distribuidor: "Distribuidor", fabricante: "Fabricante", concesionario: "Concesionario", cat: "Centro CAT", desguace: "Desguace", otro: "Otro" };

export function SuppliersPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [type, setType] = useState("");
  const [edit, setEdit] = useState<any | null>(null);
  const list = useQuery({ queryKey: ["suppliers", dq, type], queryFn: () => api.get<any[]>(`/suppliers${qs({ q: dq, type })}`) });
  return (
    <>
      <PageHead title="Proveedores" subtitle="Distribuidores de recambio nuevo, centros CAT y desguaces." actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEdit({ type: "distribuidor" })}>Nuevo proveedor</Button>} />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Nombre, contacto o ubicación" />
        <select className="select" style={{ width: 180 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo"><option value="">Todos los tipos</option>{Object.entries(SUPPLIER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <Card pad={false}>
        {list.isLoading ? <Loading /> : list.error ? <div className="card-body"><ErrorBox error={list.error} /></div> : list.data!.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Proveedor</th><th>Tipo</th><th>Contacto</th><th>Teléfono</th><th>Ubicación</th><th>Integración</th><th className="right">Artículos</th></tr></thead>
            <tbody>{list.data!.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => nav(`/proveedores/${s.id}`)}>
                <td className="strong">{s.name}</td><td><Badge>{SUPPLIER_TYPES[s.type]}</Badge></td><td className="small">{s.contact_name ?? "—"}</td><td>{s.phone ?? "—"}</td><td className="small">{s.location ?? "—"}</td>
                <td>{s.sources ? <Badge tone="lime">{s.sources} fuente(s) · {ago(s.last_sync_at)}</Badge> : <Badge>Sin fuente de datos</Badge>}</td>
                <td className="right">{s.offers}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty icon={<Building2 size={22} />} title={q || type ? "Sin coincidencias" : "Aún no hay proveedores"} action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEdit({ type: "distribuidor" })}>Nuevo proveedor</Button>} />}
      </Card>
      {edit && <SupplierForm initial={edit} onClose={() => setEdit(null)} onSaved={(s) => nav(`/proveedores/${s.id}`)} />}
    </>
  );
}

function SupplierForm({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved?: (s: any) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const keys = ["name", "contact_name", "phone", "email", "website", "type", "location", "catalog_info", "commercial_terms", "notes"] as const;
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, initial[k] ?? ""])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const s = initial.id ? await api.put<any>(`/suppliers/${initial.id}`, f) : await api.post<any>("/suppliers", f);
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["supplier", s.id] });
      toast.ok("Proveedor guardado");
      onSaved?.(s);
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title={initial.id ? "Editar proveedor" : "Nuevo proveedor"} onClose={onClose} size="wide" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Guardar</Button></>}>
      <div className="grid g3">
        <Field label="Nombre" className="span2"><input className="input" value={f.name} onChange={set("name")} /></Field>
        <Field label="Tipo"><select className="select" value={f.type} onChange={set("type")}>{Object.entries(SUPPLIER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Persona de contacto"><input className="input" value={f.contact_name} onChange={set("contact_name")} /></Field>
        <Field label="Teléfono"><input className="input" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Correo electrónico"><input className="input" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Web"><input className="input" value={f.website} onChange={set("website")} placeholder="https://" /></Field>
        <Field label="Ubicación" className="span2"><input className="input" value={f.location} onChange={set("location")} placeholder="Ciudad, provincia" /></Field>
        <Field label="Catálogo disponible" className="span-all"><textarea className="textarea" value={f.catalog_info} onChange={set("catalog_info")} placeholder="Marcas y familias que distribuye, formato de tarifa…" /></Field>
        <Field label="Condiciones comerciales" className="span-all"><textarea className="textarea" value={f.commercial_terms} onChange={set("commercial_terms")} placeholder="Descuentos, portes, plazos de pago, horarios de reparto…" /></Field>
        <Field label="Observaciones" className="span-all"><textarea className="textarea" value={f.notes} onChange={set("notes")} /></Field>
        <div className="span-all"><ErrorBox error={err} /></div>
      </div>
    </Modal>
  );
}

export function SupplierDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const q = useQuery({ queryKey: ["supplier", id], queryFn: () => api.get<any>(`/suppliers/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const s = q.data;
  return (
    <>
      <PageHead title={<span className="row">{s.name}<Badge>{SUPPLIER_TYPES[s.type]}</Badge></span>} subtitle={[s.contact_name, s.location].filter(Boolean).join(" · ")} actions={<>
        {s.phone && <a className="btn" href={`tel:${s.phone}`}><Phone size={16} />{s.phone}</a>}
        {s.email && <a className="btn" href={`mailto:${s.email}`}><Mail size={16} />Correo</a>}
        {s.website && <a className="btn" href={s.website} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Web</a>}
        <Button icon={<Pencil size={16} />} onClick={() => setEdit(true)}>Editar</Button>
        {user?.role === "admin" && <Button variant="danger" iconOnly icon={<Trash2 size={16} />} onClick={() => setDel(true)} aria-label="Eliminar" />}
      </>} />
      <div className="grid g2">
        <Card title="Catálogo y condiciones">
          <dl className="kv">
            <dt>Catálogo</dt><dd>{s.catalog_info ?? "—"}</dd>
            <dt>Condiciones</dt><dd style={{ whiteSpace: "pre-wrap" }}>{s.commercial_terms ?? "—"}</dd>
            <dt>Observaciones</dt><dd>{s.notes ?? "—"}</dd>
          </dl>
        </Card>
        <Card title="Estado de integración" icon={<Plug size={16} color="var(--lime)" />} pad={false} actions={<Link className="btn btn-sm" to="/integraciones">Gestionar</Link>}>
          {s.dataSources.length ? <table className="table"><tbody>{s.dataSources.map((d: any) => (
            <tr key={d.id}><td>{d.name}</td><td className="right">{d.items} art.</td><td className="small dim">{ago(d.last_sync_at)}</td><td className="right"><StatusBadge status={d.enabled ? d.status : "desactivado"} /></td></tr>
          ))}</tbody></table> : <Empty icon={<Plug size={18} />} title="Sin fuente de datos" action={<Link className="btn btn-sm" to="/integraciones">Crear fuente de tarifa</Link>}>Vincule una tarifa o listado de stock para que sus artículos aparezcan en el buscador.</Empty>}
        </Card>
      </div>
      <Card title="Historial de compras" pad={false} className="mt">
        {s.purchases.length ? <div className="table-wrap"><table className="table">
          <thead><tr><th>Pedido</th><th>Fecha</th><th>Artículo</th><th>Ref.</th><th className="right">Cant.</th><th className="right">Coste</th><th>Estado</th></tr></thead>
          <tbody>{s.purchases.map((p: any, i: number) => (
            <tr key={i} className="clickable" onClick={() => nav(`/pedidos/${p.order_id}`)}><td className="mono">{p.number}</td><td className="small">{dateTime(p.created_at)}</td><td>{p.description}</td><td className="mono small">{p.ref ?? "—"}</td><td className="right">{Number(p.quantity)}</td><td className="right">{eur(p.cost_price)}</td><td><StatusBadge status={p.status} /></td></tr>
          ))}</tbody>
        </table></div> : <Empty icon={<Building2 size={18} />} title="Sin compras registradas">Las líneas de pedido con este proveedor aparecerán aquí.</Empty>}
      </Card>
      {edit && <SupplierForm initial={s} onClose={() => setEdit(false)} />}
      {del && <Confirm title="Eliminar proveedor" danger confirmLabel="Eliminar" message="Las fuentes de datos vinculadas quedarán sin proveedor." onClose={() => setDel(false)}
        onConfirm={async () => { await api.del(`/suppliers/${s.id}`); qc.invalidateQueries({ queryKey: ["suppliers"] }); nav("/proveedores"); }} />}
    </>
  );
}
