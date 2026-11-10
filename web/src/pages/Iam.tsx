import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ClipboardList, Plus, ScanSearch, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHead, SearchBox, useDebounced, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ago, eur } from "../lib/format";

export function IamPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [brand, setBrand] = useState("");
  const [verified, setVerified] = useState("");
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<any | null>(null);
  const brands = useQuery({ queryKey: ["iam-brands"], queryFn: () => api.get<string[]>("/catalog/iam/brands") });
  const list = useQuery({ queryKey: ["iam", dq, brand, verified], queryFn: () => api.get<any[]>(`/catalog/iam${qs({ q: dq, brand, verified })}`) });
  async function toggleVerified(x: any) {
    try {
      await api.patch(`/catalog/iam/${x.id}`, { verified: !x.verified });
      qc.invalidateQueries({ queryKey: ["iam"] });
      toast.ok(x.verified ? "Marcada como no verificada" : "Equivalencia verificada");
    } catch (e) { toast.err(e); }
  }
  return (
    <>
      <PageHead title="Equivalencias IAM" subtitle="Referencias cruzadas entre la pieza original y los fabricantes del mercado independiente."
        actions={<><Link to="/integraciones" className="btn"><Upload size={16} />Importar equivalencias</Link><Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>Nueva equivalencia</Button></>} />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Referencia OEM, referencia IAM o fabricante" />
        <select className="select" style={{ width: 190 }} value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Fabricante"><option value="">Todos los fabricantes</option>{brands.data?.map((b) => <option key={b}>{b}</option>)}</select>
        <select className="select" style={{ width: 170 }} value={verified} onChange={(e) => setVerified(e.target.value)} aria-label="Verificación"><option value="">Verificadas y no</option><option value="si">Solo verificadas</option><option value="no">Sin verificar</option></select>
      </div>
      <Card pad={false}>
        {list.isLoading ? <Loading /> : list.error ? <div className="card-body"><ErrorBox error={list.error} /></div> : list.data!.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Ref. OEM</th><th>Fabricante</th><th>Ref. IAM</th><th>Descripción</th><th>Verificación</th><th>Mejor precio</th><th>Fuente</th><th className="right">Actualizada</th><th></th></tr></thead>
              <tbody>{list.data!.map((x) => (
                <tr key={x.id}>
                  <td className="mono"><Link to={`/buscador?ref=${x.oem_ref}`}>{x.oem_ref}</Link></td>
                  <td className="strong">{x.iam_brand}</td>
                  <td className="mono">{x.iam_ref_display}</td>
                  <td className="small">{x.description ?? "—"}</td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => toggleVerified(x)} title="Cambiar estado de verificación">{x.verified ? <Badge tone="lime"><BadgeCheck size={12} />Verificada</Badge> : <Badge tone="amber">Sin verificar</Badge>}</button></td>
                  <td>{x.best_price != null ? <span className="strong">{eur(x.best_price)}</span> : <span className="dim small">Sin oferta</span>} {x.offers > 1 && <span className="tiny dim">({x.offers})</span>}</td>
                  <td className="small muted">{x.source_label}</td>
                  <td className="right small dim">{ago(x.updated_at)}</td>
                  <td className="right nowrap">
                    <Link className="btn btn-sm btn-ghost btn-icon" to={`/buscador?ref=${encodeURIComponent(x.iam_ref)}`} title="Buscar esta referencia" aria-label="Buscar"><ScanSearch size={14} /></Link>
                    {user?.role === "admin" && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} onClick={() => setDel(x)} aria-label="Eliminar" />}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty icon={<ClipboardList size={22} />} title="No hay equivalencias" action={<Link to="/integraciones" className="btn btn-primary"><Upload size={16} />Importar tabla de equivalencias</Link>}>
          Importe las tablas de referencias cruzadas que publican los fabricantes (Bosch, Valeo, etc.) o regístrelas manualmente.</Empty>}
      </Card>
      {creating && <IamForm onClose={() => setCreating(false)} />}
      {del && <Confirm title="Eliminar equivalencia" danger confirmLabel="Eliminar" message={`${del.iam_brand} ${del.iam_ref_display} ↔ OEM ${del.oem_ref}`} onClose={() => setDel(null)}
        onConfirm={async () => { await api.del(`/catalog/iam/${del.id}`); qc.invalidateQueries({ queryKey: ["iam"] }); }} />}
    </>
  );
}

function IamForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ oem_ref: "", iam_brand: "", iam_ref: "", description: "", notes: "", source_note: "", verified: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/catalog/iam", f);
      qc.invalidateQueries({ queryKey: ["iam"] });
      toast.ok("Equivalencia registrada");
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title="Nueva equivalencia IAM" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Guardar</Button></>}>
      <div className="stack">
        <div className="grid g3">
          <Field label="Referencia OEM"><input className="input mono" value={f.oem_ref} onChange={set("oem_ref")} /></Field>
          <Field label="Fabricante IAM"><input className="input" value={f.iam_brand} onChange={set("iam_brand")} placeholder="Bosch, Valeo…" /></Field>
          <Field label="Referencia IAM"><input className="input mono" value={f.iam_ref} onChange={set("iam_ref")} /></Field>
          <Field label="Descripción" className="span2"><input className="input" value={f.description} onChange={set("description")} /></Field>
          <Field label="Origen"><input className="input" value={f.source_note} onChange={set("source_note")} placeholder="Catálogo Bosch 2026" /></Field>
          <Field label="Notas" className="span-all"><input className="input" value={f.notes} onChange={set("notes")} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.verified} onChange={(e) => setF({ ...f, verified: e.target.checked })} />Equivalencia publicada por el fabricante o catálogo técnico (verificada)</label>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}
