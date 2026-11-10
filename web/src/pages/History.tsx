import { useQuery } from "@tanstack/react-query";
import { History as HistoryIcon, ScanSearch } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Card, Empty, ErrorBox, Loading, PageHead, SearchBox, StatusBadge, statusLabel, useDebounced } from "../components/ui";
import { api, qs } from "../lib/api";
import { dateTime, ms } from "../lib/format";

export function HistoryPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const list = useQuery({ queryKey: ["history", dq, status, mine, from, to], queryFn: () => api.get<any[]>(`/history${qs({ q: dq, status, user: mine ? "me" : "", from, to })}`) });
  const saved = useQuery({ queryKey: ["saved"], queryFn: () => api.get<any[]>("/search/saved") });
  return (
    <>
      <PageHead title="Historial de búsquedas" subtitle="Todas las búsquedas del equipo. Pulse una para recuperar sus resultados." />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Matrícula, pieza, referencia, marca…" />
        <select className="select" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado">
          <option value="">Todos los estados</option>{["completado", "sin_resultados", "requiere_vehiculo", "requiere_pieza"].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <input className="input" type="date" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
        <input className="input" type="date" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
        <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Solo mis búsquedas</label>
      </div>
      <Card pad={false}>
        {list.isLoading ? <Loading /> : list.error ? <div className="card-body"><ErrorBox error={list.error} /></div> : list.data!.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Vehículo</th><th>Pieza / referencia</th><th>Resultados</th><th>Estado</th><th>Cliente</th><th>Usuario</th><th className="right">Tiempo</th></tr></thead>
            <tbody>{list.data!.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => nav(`/buscador?h=${s.id}`)}>
                <td className="small nowrap">{dateTime(s.created_at)}</td>
                <td><div className="mono strong">{s.plate ?? s.vin ?? s.query_vehicle ?? "—"}</div><div className="tiny dim">{[s.make, s.model].filter(Boolean).join(" ")}</div></td>
                <td>{s.part_name ?? s.query_part ?? "—"}{s.query_ref && <div className="tiny mono dim">{s.query_ref}</div>}</td>
                <td><span className="row" style={{ gap: 6 }}><Badge>A {s.count_oem}</Badge><Badge>B {s.count_iam}</Badge><Badge>C {s.count_cat}</Badge></span></td>
                <td><StatusBadge status={s.status} /></td>
                <td className="small">{s.customer_name ?? "—"}</td>
                <td className="small muted">{s.user_name ?? "—"}</td>
                <td className="right small">{ms(s.duration_ms)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty icon={<HistoryIcon size={22} />} title="No hay búsquedas" action={<Link className="btn btn-primary" to="/buscador"><ScanSearch size={16} />Ir al buscador</Link>} />}
      </Card>
      <Card title="Resultados guardados" pad={false} className="mt">
        {saved.data?.length ? <div className="table-wrap"><table className="table">
          <thead><tr><th>Guardado</th><th>Pieza</th><th>Referencia</th><th>Proveedor</th><th className="right">Precio</th><th></th></tr></thead>
          <tbody>{saved.data.map((s) => (
            <tr key={s.id}>
              <td className="small">{dateTime(s.created_at)}</td>
              <td>{s.item.name}<div className="tiny dim">{s.item.brand}</div></td>
              <td className="mono small">{s.item.ref ?? s.item.oemRef ?? "—"}</td>
              <td className="small">{s.item.supplier?.name ?? s.item.source?.label ?? "—"}</td>
              <td className="right">{s.item.price != null ? `${Number(s.item.price).toFixed(2)} €` : "—"}</td>
              <td className="right nowrap">
                {s.search_id && <Link className="btn btn-sm btn-ghost" to={`/buscador?h=${s.search_id}`}>Ver búsqueda</Link>}
                <button className="btn btn-sm btn-ghost" onClick={async () => { await api.del(`/search/saved/${s.id}`); saved.refetch(); }}>Quitar</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div> : <Empty icon={<HistoryIcon size={18} />} title="Sin resultados guardados">Use el botón «Guardar» de una tarjeta de resultado.</Empty>}
      </Card>
    </>
  );
}
