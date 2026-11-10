import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Car, Pencil, Plus, ScanSearch, Trash2 } from "lucide-react";
import { Fragment, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHead, SearchBox, StatusBadge, useDebounced, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ago, dateTime } from "../lib/format";
import type { Vehicle } from "../lib/types";

export function VehiclesPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [edit, setEdit] = useState<Partial<Vehicle> | null>(null);
  const list = useQuery({ queryKey: ["vehicles", dq], queryFn: () => api.get<(Vehicle & { searches: number; last_search_at: string | null })[]>(`/vehicles${qs({ q: dq })}`) });
  return (
    <>
      <PageHead title="Vehículos" subtitle="Fichas de los vehículos consultados y su historial de piezas." actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEdit({})}>Nuevo vehículo</Button>} />
      <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder="Matrícula, bastidor, marca, modelo o motor" /></div>
      <Card pad={false}>
        {list.isLoading ? <Loading /> : list.error ? <div className="card-body"><ErrorBox error={list.error} /></div> : list.data!.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Matrícula</th><th>Bastidor</th><th>Vehículo</th><th>Motor</th><th>Combustible</th><th>Identificación</th><th className="right">Búsquedas</th><th className="right">Última</th></tr></thead>
              <tbody>
                {list.data!.map((v) => (
                  <tr key={v.id} className="clickable" onClick={() => nav(`/vehiculos/${v.id}`)}>
                    <td className="mono strong">{v.plate ?? "—"}</td>
                    <td className="mono small muted">{v.vin ?? "—"}</td>
                    <td>{[v.make, v.model, v.generation].filter(Boolean).join(" ") || <span className="dim">Sin datos</span>} {v.year && <span className="dim">· {v.year}</span>}</td>
                    <td className="mono">{v.engine_code ?? "—"}</td>
                    <td>{v.fuel ?? "—"}</td>
                    <td>{v.identification_level === "confirmada" ? <Badge tone="lime">Confirmada</Badge> : <Badge tone="amber">Parcial</Badge>}</td>
                    <td className="right">{v.searches}</td>
                    <td className="right small dim">{ago(v.last_search_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={<Car size={22} />} title={q ? "Sin coincidencias" : "Todavía no hay vehículos"} action={<Link to="/buscador" className="btn btn-primary"><ScanSearch size={16} />Ir al buscador</Link>}>Los vehículos se registran automáticamente al buscar por matrícula o bastidor.</Empty>}
      </Card>
      {edit && <VehicleForm initial={edit} onClose={() => setEdit(null)} onSaved={(v) => nav(`/vehiculos/${v.id}`)} />}
    </>
  );
}

export function VehicleForm({ initial, onClose, onSaved }: { initial: Partial<Vehicle>; onClose: () => void; onSaved: (v: Vehicle) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>(() =>
    Object.fromEntries(["plate", "vin", "make", "model", "generation", "year", "version", "engine", "engine_code", "displacement_cc", "power_kw", "fuel", "transmission", "notes"]
      .map((k) => [k, (initial as any)[k] != null ? String((initial as any)[k]) : ""])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    setErr(null);
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? undefined : ["year", "displacement_cc", "power_kw"].includes(k) ? Number(v) : v]));
    try {
      const v = initial.id ? await api.put<Vehicle>(`/vehicles/${initial.id}`, body) : await api.post<Vehicle>("/vehicles", body);
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["vehicle", v.id] });
      toast.ok("Vehículo guardado");
      onSaved(v);
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title={initial.id ? "Editar vehículo" : "Nuevo vehículo"} onClose={onClose} size="wide" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Guardar</Button></>}>
      <div className="stack">
        <div className="grid g4">
          <Field label="Matrícula"><input className="input mono" value={f.plate} onChange={set("plate")} /></Field>
          <Field label="Bastidor (VIN)" className="span2"><input className="input mono" maxLength={17} value={f.vin} onChange={set("vin")} /></Field>
          <Field label="Año"><input className="input" inputMode="numeric" value={f.year} onChange={set("year")} /></Field>
          <Field label="Marca"><input className="input" value={f.make} onChange={set("make")} /></Field>
          <Field label="Modelo"><input className="input" value={f.model} onChange={set("model")} /></Field>
          <Field label="Generación"><input className="input" value={f.generation} onChange={set("generation")} /></Field>
          <Field label="Versión"><input className="input" value={f.version} onChange={set("version")} /></Field>
          <Field label="Motor (descripción)"><input className="input" value={f.engine} onChange={set("engine")} placeholder="1.9 TDI" /></Field>
          <Field label="Código de motor"><input className="input mono" value={f.engine_code} onChange={set("engine_code")} /></Field>
          <Field label="Cilindrada (cc)"><input className="input" inputMode="numeric" value={f.displacement_cc} onChange={set("displacement_cc")} /></Field>
          <Field label="Potencia (kW)"><input className="input" inputMode="numeric" value={f.power_kw} onChange={set("power_kw")} /></Field>
          <Field label="Combustible">
            <select className="select" value={f.fuel} onChange={set("fuel")}><option value="">—</option><option>Diésel</option><option>Gasolina</option><option>Híbrido</option><option>Eléctrico</option><option>GLP</option><option>GNC</option></select>
          </Field>
          <Field label="Transmisión">
            <select className="select" value={f.transmission} onChange={set("transmission")}><option value="">—</option><option>Manual</option><option>Automática</option></select>
          </Field>
          <Field label="Observaciones" className="span2"><input className="input" value={f.notes} onChange={set("notes")} /></Field>
        </div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

export function VehicleDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [del, setDel] = useState(false);
  const q = useQuery({ queryKey: ["vehicle", id], queryFn: () => api.get<any>(`/vehicles/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const v = q.data;
  async function confirm() {
    try {
      await api.put(`/vehicles/${v.id}`, { ...v, confirm: true });
      qc.invalidateQueries({ queryKey: ["vehicle", id] });
      toast.ok("Identificación confirmada");
    } catch (e) { toast.err(e); }
  }
  return (
    <>
      <PageHead
        title={<span className="row">{v.plate && <span className="mono">{v.plate}</span>}<span className="muted">{[v.make, v.model].filter(Boolean).join(" ") || "Vehículo"}</span></span>}
        subtitle={v.identification_source ? `Fuente de identificación: ${v.identification_source}` : undefined}
        actions={<>
          <Link className="btn btn-primary" to={`/buscador?vehicleId=${v.id}`}><ScanSearch size={16} />Buscar pieza</Link>
          <Button icon={<Pencil size={16} />} onClick={() => setEditing(true)}>Editar</Button>
          {v.identification_level !== "confirmada" && <Button icon={<BadgeCheck size={16} />} onClick={confirm} disabled={!v.make || !v.model || !v.engine_code || !v.year} title="Requiere marca, modelo, año y código de motor">Confirmar datos</Button>}
          {user?.role === "admin" && <Button variant="danger" iconOnly icon={<Trash2 size={16} />} onClick={() => setDel(true)} aria-label="Eliminar" />}
        </>}
      />
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,2fr)" }}>
        <Card title="Ficha técnica" actions={v.identification_level === "confirmada" ? <Badge tone="lime">Confirmada</Badge> : <Badge tone="amber">Parcial</Badge>}>
          <dl className="kv">
            {[["Matrícula", v.plate], ["Bastidor", v.vin], ["Marca", v.make], ["Modelo", v.model], ["Generación", v.generation], ["Año", v.year], ["Versión", v.version],
              ["Motor", v.engine], ["Código de motor", v.engine_code], ["Cilindrada", v.displacement_cc && `${v.displacement_cc} cc`], ["Potencia", v.power_kw && `${v.power_kw} kW (${Math.round(v.power_kw * 1.36)} CV)`],
              ["Combustible", v.fuel], ["Transmisión", v.transmission], ["Observaciones", v.notes], ["Alta", dateTime(v.created_at)]].map(([k, val]) => (
              <Fragment key={k as string}><dt>{k}</dt><dd className={k === "Bastidor" || k === "Código de motor" ? "mono" : ""}>{val ?? <span className="dim">—</span>}</dd></Fragment>
            ))}
          </dl>
        </Card>
        <Card title="Historial de piezas consultadas" pad={false}>
          {v.searches.length ? (
            <table className="table">
              <thead><tr><th>Fecha</th><th>Pieza / referencia</th><th>Resultados</th><th>Usuario</th></tr></thead>
              <tbody>{v.searches.map((s: any) => (
                <tr key={s.id} className="clickable" onClick={() => nav(`/buscador?h=${s.id}`)}>
                  <td className="small nowrap">{dateTime(s.created_at)}</td>
                  <td>{s.query_part ?? s.query_ref ?? "—"}</td>
                  <td><span className="row" style={{ gap: 6 }}><StatusBadge status={s.status} /><Badge>A {s.count_oem}</Badge><Badge>B {s.count_iam}</Badge><Badge>C {s.count_cat}</Badge></span></td>
                  <td className="small muted">{s.user_name}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty icon={<ScanSearch size={20} />} title="Sin búsquedas" action={<Link className="btn" to={`/buscador?vehicleId=${v.id}`}>Buscar una pieza</Link>} />}
          {v.quotes.length > 0 && (
            <div className="card-body">
              <div className="label mb">Presupuestos de este vehículo</div>
              <div className="row row-wrap">{v.quotes.map((x: any) => <Link key={x.id} className="btn btn-sm" to={`/presupuestos/${x.id}`}>{x.number} · <StatusBadge status={x.status} /></Link>)}</div>
            </div>
          )}
        </Card>
      </div>
      {editing && <VehicleForm initial={v} onClose={() => setEditing(false)} onSaved={() => {}} />}
      {del && <Confirm title="Eliminar vehículo" danger confirmLabel="Eliminar" message="Se eliminará la ficha. Las búsquedas y presupuestos se conservan sin vínculo al vehículo." onClose={() => setDel(false)}
        onConfirm={async () => { await api.del(`/vehicles/${v.id}`); qc.invalidateQueries({ queryKey: ["vehicles"] }); nav("/vehiculos"); }} />}
    </>
  );
}
