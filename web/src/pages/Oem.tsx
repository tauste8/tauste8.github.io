import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Layers, Plus, ScanSearch, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHead, SearchBox, useDebounced, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ago, eur } from "../lib/format";
import { usePartTypes } from "./Search";

export function OemPage() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [partCode, setPartCode] = useState("");
  const [make, setMake] = useState("");
  const [verified, setVerified] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const parts = usePartTypes();
  const makes = useQuery({ queryKey: ["oem-makes"], queryFn: () => api.get<string[]>("/catalog/oem/makes") });
  const list = useQuery({ queryKey: ["oem", dq, partCode, make, verified], queryFn: () => api.get<any[]>(`/catalog/oem${qs({ q: dq, part_code: partCode, make, verified })}`) });
  const pname = (c: string | null) => parts.data?.find((p) => p.code === c)?.name ?? c ?? "—";
  return (
    <>
      <PageHead title="Referencias OEM" subtitle="Referencias originales con sus aplicaciones por vehículo, sustituciones y equivalencias."
        actions={<><Link to="/integraciones" className="btn"><Upload size={16} />Importar catálogo</Link><Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>Nueva referencia</Button></>} />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Referencia, descripción, modelo o código de motor" />
        <select className="select" style={{ width: 200 }} value={partCode} onChange={(e) => setPartCode(e.target.value)} aria-label="Tipo"><option value="">Todos los tipos</option>{parts.data?.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
        <select className="select" style={{ width: 170 }} value={make} onChange={(e) => setMake(e.target.value)} aria-label="Marca"><option value="">Todas las marcas</option>{makes.data?.map((m) => <option key={m}>{m}</option>)}</select>
        <select className="select" style={{ width: 170 }} value={verified} onChange={(e) => setVerified(e.target.value)} aria-label="Verificación"><option value="">Verificadas y no</option><option value="si">Solo verificadas</option><option value="no">Sin verificar</option></select>
      </div>
      <Card pad={false}>
        {list.isLoading ? <Loading /> : list.error ? <div className="card-body"><ErrorBox error={list.error} /></div> : list.data!.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Referencia</th><th>Marca</th><th>Descripción</th><th>Tipo</th><th>Aplicaciones</th><th>Equivalencias</th><th>Fuente</th><th className="right">Actualizada</th></tr></thead>
              <tbody>{list.data!.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                  <td className="mono strong">{r.oem_ref_display}{r.superseded_by && <div className="tiny" style={{ color: "var(--amber)" }}>→ {r.superseded_by}</div>}</td>
                  <td>{r.vehicle_make}</td>
                  <td>{r.description}</td>
                  <td className="small">{pname(r.part_code)}</td>
                  <td>{r.applications}</td>
                  <td>{r.equivalences}</td>
                  <td className="small">{r.verified && <BadgeCheck size={13} color="var(--lime)" style={{ verticalAlign: -2, marginRight: 4 }} />}{r.source_label}</td>
                  <td className="right small dim">{ago(r.updated_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty icon={<Layers size={22} />} title="No hay referencias OEM" action={<Link to="/integraciones" className="btn btn-primary"><Upload size={16} />Importar catálogo OEM</Link>}>
          Importe un catálogo OEM en CSV/Excel, registre referencias manualmente o regístrelas desde el buscador cuando las consulte en el despiece original.</Empty>}
      </Card>
      {open && <OemDetail id={open} onClose={() => setOpen(null)} />}
      {creating && <OemForm onClose={() => setCreating(false)} />}
    </>
  );
}

function OemDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const q = useQuery({ queryKey: ["oem", id], queryFn: () => api.get<any>(`/catalog/oem/${id}`) });
  const r = q.data;
  return (
    <Modal title={r ? <span className="mono">{r.oem_ref_display}</span> : "Referencia OEM"} onClose={onClose} size="wide" footer={r && <>
      {user?.role === "admin" && <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => setDel(true)} style={{ marginRight: "auto" }}>Eliminar</Button>}
      <Link className="btn" to={`/buscador?ref=${encodeURIComponent(r.oem_ref)}`}><ScanSearch size={16} />Buscar ofertas</Link>
      <Button variant="primary" onClick={() => setEdit(true)}>Editar</Button>
    </>}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : (
        <div className="stack">
          <div className="row row-wrap">
            <b>{r.description}</b><Badge>{r.vehicle_make}</Badge>
            {r.verified ? <Badge tone="lime"><BadgeCheck size={12} />Verificada</Badge> : <Badge tone="amber">Sin verificar</Badge>}
            {r.superseded_by && <Badge tone="amber">Sustituida por {r.superseded_by}</Badge>}
            <span className="small dim">Fuente: {r.source_label}</span>
          </div>
          {Object.keys(r.specs ?? {}).length > 0 && <div className="small">{Object.entries(r.specs).map(([k, v]) => <Badge key={k}>{k.replace(/_/g, " ")}: {String(v)}</Badge>)}</div>}
          <div className="label">Aplicaciones por vehículo</div>
          {r.applications.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Marca</th><th>Modelo</th><th>Gen.</th><th>Años</th><th>Motores</th><th>Combustible</th><th>kW</th><th>Posición</th></tr></thead>
              <tbody>{r.applications.map((a: any) => (
                <tr key={a.id}><td>{a.make}</td><td>{a.model ?? "—"}</td><td>{a.generation ?? "—"}</td><td>{a.year_from ?? "…"}–{a.year_to ?? "…"}</td><td className="mono small">{a.engine_codes.join(", ") || "—"}</td><td>{a.fuel ?? "—"}</td><td>{a.power_kw_from ? `${a.power_kw_from}–${a.power_kw_to ?? ""}` : "—"}</td><td>{a.position ?? "—"}</td></tr>
              ))}</tbody>
            </table></div>
          ) : <span className="small dim">Sin aplicaciones: no se podrá confirmar la compatibilidad con ningún vehículo.</span>}
          <div className="label">Equivalencias IAM</div>
          {r.crossReferences.length ? (
            <div className="row row-wrap">{r.crossReferences.map((x: any) => <Badge key={x.id} tone={x.verified ? "lime" : undefined}>{x.iam_brand} <span className="mono">{x.iam_ref_display}</span></Badge>)}</div>
          ) : <span className="small dim">Sin equivalencias registradas.</span>}
          <div className="label">Ofertas de proveedores</div>
          {r.offers.length ? (
            <table className="table"><tbody>{r.offers.map((o: any) => (
              <tr key={o.id}><td>{o.description}</td><td>{o.brand ?? "—"}</td><td>{o.supplier_name ?? "—"}</td><td>{o.condition}</td><td className="right strong">{eur(o.price)}</td></tr>
            ))}</tbody></table>
          ) : <span className="small dim">Ningún proveedor conectado ofrece esta referencia.</span>}
        </div>
      )}
      {edit && r && <OemForm initial={r} onClose={() => { setEdit(false); qc.invalidateQueries({ queryKey: ["oem", id] }); }} />}
      {del && <Confirm title="Eliminar referencia" danger confirmLabel="Eliminar" message="Se eliminará la referencia y sus aplicaciones." onClose={() => setDel(false)}
        onConfirm={async () => { await api.del(`/catalog/oem/${id}`); qc.invalidateQueries({ queryKey: ["oem"] }); toast.ok("Referencia eliminada"); onClose(); }} />}
    </Modal>
  );
}

const emptyApp = { make: "", model: "", generation: "", year_from: "", year_to: "", engine_codes: "", fuel: "", power_kw_from: "", power_kw_to: "", transmission: "", position: "" };

function OemForm({ initial, onClose }: { initial?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const parts = usePartTypes();
  const [f, setF] = useState({
    oem_ref: initial?.oem_ref_display ?? "", vehicle_make: initial?.vehicle_make ?? "", description: initial?.description ?? "", part_code: initial?.part_code ?? "",
    superseded_by: initial?.superseded_by ?? "", verified: initial?.verified ?? false, source_note: "",
  });
  const [apps, setApps] = useState<any[]>(initial?.applications?.map((a: any) => ({ ...emptyApp, ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v ?? ""])), engine_codes: a.engine_codes.join(", ") })) ?? [{ ...emptyApp }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const setApp = (i: number, k: string, v: string) => setApps(apps.map((a, j) => (j === i ? { ...a, [k]: v } : a)));
  async function save() {
    setBusy(true);
    setErr(null);
    const n = (v: string) => (v === "" ? null : Number(v));
    const body = {
      ...f, part_code: f.part_code || null, superseded_by: f.superseded_by || null, specs: initial?.specs ?? {},
      applications: apps.filter((a) => a.make || f.vehicle_make).map((a) => ({
        ...a, make: a.make || f.vehicle_make, year_from: n(a.year_from), year_to: n(a.year_to), power_kw_from: n(a.power_kw_from), power_kw_to: n(a.power_kw_to),
        engine_codes: String(a.engine_codes).split(/[,|\s]+/).filter(Boolean),
      })),
    };
    try {
      if (initial?.id) await api.put(`/catalog/oem/${initial.id}`, body);
      else await api.post("/catalog/oem", body);
      qc.invalidateQueries({ queryKey: ["oem"] });
      toast.ok("Referencia guardada");
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title={initial ? "Editar referencia OEM" : "Nueva referencia OEM"} onClose={onClose} size="wide" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Guardar</Button></>}>
      <div className="stack">
        <div className="grid g4">
          <Field label="Referencia OEM"><input className="input mono" value={f.oem_ref} onChange={(e) => setF({ ...f, oem_ref: e.target.value })} /></Field>
          <Field label="Marca del vehículo"><input className="input" value={f.vehicle_make} onChange={(e) => setF({ ...f, vehicle_make: e.target.value })} /></Field>
          <Field label="Tipo de pieza"><select className="select" value={f.part_code} onChange={(e) => setF({ ...f, part_code: e.target.value })}><option value="">—</option>{parts.data?.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
          <Field label="Sustituida por"><input className="input mono" value={f.superseded_by} onChange={(e) => setF({ ...f, superseded_by: e.target.value })} /></Field>
          <Field label="Descripción" className="span2"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          {!initial && <Field label="Origen" className="span2" hint="Catálogo, concesionario, etiqueta…"><input className="input" value={f.source_note} onChange={(e) => setF({ ...f, source_note: e.target.value })} /></Field>}
        </div>
        <label className="check"><input type="checkbox" checked={f.verified} onChange={(e) => setF({ ...f, verified: e.target.checked })} />Verificada en el catálogo original del fabricante</label>
        <div className="row between"><div className="label">Aplicaciones por vehículo</div><Button size="sm" icon={<Plus size={14} />} onClick={() => setApps([...apps, { ...emptyApp }])}>Añadir aplicación</Button></div>
        <div className="table-wrap">
          <table className="table lines-table">
            <thead><tr><th>Marca</th><th>Modelo</th><th>Gen.</th><th>Desde</th><th>Hasta</th><th>Códigos motor</th><th>Combustible</th><th>Posición</th><th></th></tr></thead>
            <tbody>{apps.map((a, i) => (
              <tr key={i}>
                {(["make", "model", "generation", "year_from", "year_to", "engine_codes", "fuel", "position"] as const).map((k) => (
                  <td key={k}><input className="input" style={{ minWidth: k === "engine_codes" ? 140 : 80 }} placeholder={k === "make" ? f.vehicle_make : ""} value={a[k]} onChange={(e) => setApp(i, k, e.target.value)} aria-label={k} /></td>
                ))}
                <td><Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} onClick={() => setApps(apps.filter((_, j) => j !== i))} aria-label="Quitar" /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}
