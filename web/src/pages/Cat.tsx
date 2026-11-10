import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Mail, Phone, Recycle, ScanSearch, Upload } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, Empty, ErrorBox, Loading, PageHead, SearchBox, useDebounced } from "../components/ui";
import { api, qs } from "../lib/api";
import { ago, eur } from "../lib/format";
import { usePartTypes } from "./Search";

export function CatPage() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [partCode, setPartCode] = useState("");
  const [sourceId, setSourceId] = useState("");
  const parts = usePartTypes();
  const sources = useQuery({ queryKey: ["cat-sources"], queryFn: () => api.get<{ id: string; name: string; items: number }[]>("/catalog/cat/sources") });
  const list = useQuery({ queryKey: ["cat", dq, partCode, sourceId], queryFn: () => api.get<{ offers: any[]; inventory: any[] }>(`/catalog/cat${qs({ q: dq, part_code: partCode, source_id: sourceId })}`) });
  const pname = (c: string | null) => parts.data?.find((p) => p.code === c)?.name ?? "—";
  const rows = list.data ? [
    ...list.data.inventory.map((i) => ({ ...i, _kind: "inv", source_name: "Inventario propio", price: i.sale_price, stock: i.quantity })),
    ...list.data.offers.map((o) => ({ ...o, _kind: "offer" })),
  ] : [];
  return (
    <>
      <PageHead title="Recambios usados CAT" subtitle="Stock de centros autorizados de tratamiento y desguaces conectados, más el usado de su inventario."
        actions={<Link to="/integraciones" className="btn"><Upload size={16} />Importar stock CAT</Link>} />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Referencia OEM, pieza, marca, modelo, motor o provincia" />
        <select className="select" style={{ width: 200 }} value={partCode} onChange={(e) => setPartCode(e.target.value)} aria-label="Tipo"><option value="">Todos los tipos</option>{parts.data?.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
        <select className="select" style={{ width: 220 }} value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="Centro"><option value="">Todos los centros</option>{sources.data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.items})</option>)}</select>
      </div>
      <Card pad={false}>
        {list.isLoading ? <Loading /> : list.error ? <div className="card-body"><ErrorBox error={list.error} /></div> : rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Pieza</th><th>Ref. OEM</th><th>Vehículo donante</th><th>Centro / proveedor</th><th>Ubicación</th><th className="right">Precio</th><th className="right">Actualizado</th><th></th></tr></thead>
              <tbody>{rows.map((o) => (
                <tr key={o._kind + o.id}>
                  <td><div className="strong">{o.description}</div><div className="tiny dim">{pname(o.part_code)}</div></td>
                  <td className="mono small">{o.oem_ref ?? <span className="dim">Sin referencia</span>}</td>
                  <td className="small">{[o.vehicle_make, o.vehicle_model, o.vehicle_year, o.vehicle_engine_code].filter(Boolean).join(" ") || "—"}</td>
                  <td>{o._kind === "inv" ? <Badge tone="lime">Inventario propio</Badge> : <>{o.supplier_name ?? o.source_name}</>}</td>
                  <td className="small muted">{o.location ?? "—"}</td>
                  <td className="right strong">{eur(o.price)}</td>
                  <td className="right small dim">{ago(o.source_updated_at ?? o.updated_at)}</td>
                  <td className="right nowrap">
                    {o.oem_ref && <Link className="btn btn-sm btn-ghost btn-icon" to={`/buscador?ref=${o.oem_ref}`} title="Buscar equivalencias" aria-label="Buscar"><ScanSearch size={14} /></Link>}
                    {o.supplier_phone && <a className="btn btn-sm btn-ghost btn-icon" href={`tel:${o.supplier_phone}`} title="Llamar" aria-label="Llamar"><Phone size={14} /></a>}
                    {o.supplier_email && <a className="btn btn-sm btn-ghost btn-icon" href={`mailto:${o.supplier_email}?subject=${encodeURIComponent(`Consulta pieza usada ${o.oem_ref ?? o.description}`)}`} title="Correo" aria-label="Correo"><Mail size={14} /></a>}
                    {o.external_url && <a className="btn btn-sm btn-ghost btn-icon" href={o.external_url} target="_blank" rel="noopener noreferrer" title="Ver ficha" aria-label="Ver ficha"><ExternalLink size={14} /></a>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty icon={<Recycle size={22} />} title="No hay piezas usadas" action={<Link to="/integraciones" className="btn btn-primary"><Upload size={16} />Importar stock de un centro CAT</Link>}>
          Cree una fuente «Recambio usado» en Integraciones y cargue el listado de stock (CSV/Excel) que le facilite cada centro CAT o desguace.</Empty>}
      </Card>
    </>
  );
}
