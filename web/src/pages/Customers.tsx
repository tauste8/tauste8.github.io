import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Pencil, Phone, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Card, Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHead, SearchBox, StatusBadge, useDebounced, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime } from "../lib/format";

export function CustomersPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [edit, setEdit] = useState<any | null>(null);
  const list = useQuery({ queryKey: ["customers", dq], queryFn: () => api.get<any[]>(`/customers${qs({ q: dq })}`) });
  return (
    <>
      <PageHead title="Clientes" subtitle="Talleres y particulares: consultas, presupuestos y pedidos." actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEdit({})}>Nuevo cliente</Button>} />
      <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder="Nombre, teléfono, correo o NIF" /></div>
      <Card pad={false}>
        {list.isLoading ? <Loading /> : list.error ? <div className="card-body"><ErrorBox error={list.error} /></div> : list.data!.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Nombre / empresa</th><th>NIF</th><th>Teléfono</th><th>Correo</th><th className="right">Consultas</th><th className="right">Presupuestos</th><th className="right">Pedidos</th></tr></thead>
            <tbody>{list.data!.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => nav(`/clientes/${c.id}`)}>
                <td className="strong">{c.name}</td><td className="small">{c.tax_id ?? "—"}</td><td>{c.phone ?? "—"}</td><td className="small">{c.email ?? "—"}</td>
                <td className="right">{c.searches}</td><td className="right">{c.quotes}</td><td className="right">{c.orders}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty icon={<Users size={22} />} title={q ? "Sin coincidencias" : "Aún no hay clientes"} action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEdit({})}>Nuevo cliente</Button>} />}
      </Card>
      {edit && <CustomerForm initial={edit} onClose={() => setEdit(null)} onSaved={(c) => nav(`/clientes/${c.id}`)} />}
    </>
  );
}

export function CustomerForm({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved?: (c: any) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: initial.name ?? "", tax_id: initial.tax_id ?? "", phone: initial.phone ?? "", email: initial.email ?? "", address: initial.address ?? "", notes: initial.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const c = initial.id ? await api.put<any>(`/customers/${initial.id}`, f) : await api.post<any>("/customers", f);
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customer", c.id] });
      toast.ok("Cliente guardado");
      onSaved?.(c);
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title={initial.id ? "Editar cliente" : "Nuevo cliente"} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Guardar</Button></>}>
      <div className="grid g2">
        <Field label="Nombre o empresa" className="span2"><input className="input" value={f.name} onChange={set("name")} /></Field>
        <Field label="NIF / CIF"><input className="input" value={f.tax_id} onChange={set("tax_id")} /></Field>
        <Field label="Teléfono"><input className="input" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Correo electrónico" className="span2"><input className="input" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Dirección" className="span2"><input className="input" value={f.address} onChange={set("address")} /></Field>
        <Field label="Observaciones" className="span2"><textarea className="textarea" value={f.notes} onChange={set("notes")} /></Field>
        <div className="span2"><ErrorBox error={err} /></div>
      </div>
    </Modal>
  );
}

export function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const q = useQuery({ queryKey: ["customer", id], queryFn: () => api.get<any>(`/customers/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const c = q.data;
  return (
    <>
      <PageHead title={c.name} subtitle={[c.tax_id, c.address].filter(Boolean).join(" · ")} actions={<>
        {c.phone && <a className="btn" href={`tel:${c.phone}`}><Phone size={16} />{c.phone}</a>}
        {c.email && <a className="btn" href={`mailto:${c.email}`}><Mail size={16} />Correo</a>}
        <Button icon={<Pencil size={16} />} onClick={() => setEdit(true)}>Editar</Button>
        {user?.role === "admin" && <Button variant="danger" iconOnly icon={<Trash2 size={16} />} onClick={() => setDel(true)} aria-label="Eliminar" />}
      </>} />
      {c.notes && <div className="card card-pad mb muted">{c.notes}</div>}
      <div className="grid g3">
        <Card title="Consultas" pad={false}>
          {c.searches.length ? <table className="table"><tbody>{c.searches.map((s: any) => (
            <tr key={s.id} className="clickable" onClick={() => nav(`/buscador?h=${s.id}`)}><td className="small">{dateTime(s.created_at)}</td><td>{s.query_part ?? s.query_ref}</td><td className="mono small">{s.query_vehicle}</td></tr>
          ))}</tbody></table> : <Empty icon={<Users size={18} />} title="Sin consultas">Seleccione el cliente en el buscador para asociarle la búsqueda.</Empty>}
        </Card>
        <Card title="Presupuestos" pad={false} actions={<Link className="btn btn-sm" to={`/presupuestos/nuevo?customer=${c.id}`}><Plus size={14} />Nuevo</Link>}>
          {c.quotes.length ? <table className="table"><tbody>{c.quotes.map((x: any) => (
            <tr key={x.id} className="clickable" onClick={() => nav(`/presupuestos/${x.id}`)}><td className="mono">{x.number}</td><td className="small">{dateTime(x.created_at)}</td><td className="right"><StatusBadge status={x.status} /></td></tr>
          ))}</tbody></table> : <Empty icon={<Users size={18} />} title="Sin presupuestos" />}
        </Card>
        <Card title="Pedidos" pad={false}>
          {c.orders.length ? <table className="table"><tbody>{c.orders.map((x: any) => (
            <tr key={x.id} className="clickable" onClick={() => nav(`/pedidos/${x.id}`)}><td className="mono">{x.number}</td><td className="small">{dateTime(x.created_at)}</td><td className="right"><StatusBadge status={x.status} /></td></tr>
          ))}</tbody></table> : <Empty icon={<Users size={18} />} title="Sin pedidos" />}
        </Card>
      </div>
      {edit && <CustomerForm initial={c} onClose={() => setEdit(false)} />}
      {del && <Confirm title="Eliminar cliente" danger confirmLabel="Eliminar" message="Los presupuestos y pedidos se conservan sin cliente asociado." onClose={() => setDel(false)}
        onConfirm={async () => { await api.del(`/customers/${c.id}`); qc.invalidateQueries({ queryKey: ["customers"] }); nav("/clientes"); }} />}
    </>
  );
}
