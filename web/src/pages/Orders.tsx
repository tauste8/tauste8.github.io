import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, Truck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Card, Empty, ErrorBox, Loading, PageHead, SearchBox, StatusBadge, statusLabel, useDebounced, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { date, dateTime, eur } from "../lib/format";

const STATUSES = ["pendiente", "solicitado_proveedor", "recibido", "entregado", "cancelado"];

export function OrdersPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [status, setStatus] = useState("");
  const list = useQuery({ queryKey: ["orders", dq, status], queryFn: () => api.get<any[]>(`/orders${qs({ q: dq, status })}`) });
  return (
    <>
      <PageHead title="Pedidos" subtitle="Presupuestos aceptados y su seguimiento hasta la entrega." />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Número, cliente o matrícula" />
        <select className="select" style={{ width: 220 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado"><option value="">Todos los estados</option>{STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
      </div>
      <Card pad={false}>
        {list.isLoading ? <Loading /> : list.error ? <div className="card-body"><ErrorBox error={list.error} /></div> : list.data!.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Número</th><th>Fecha</th><th>Presupuesto</th><th>Cliente</th><th>Vehículo</th><th className="right">Líneas</th><th className="right">Total</th><th>Estado</th></tr></thead>
            <tbody>{list.data!.map((x) => (
              <tr key={x.id} className="clickable" onClick={() => nav(`/pedidos/${x.id}`)}>
                <td className="mono strong">{x.number}</td><td className="small">{date(x.created_at)}</td><td className="mono small">{x.quote_number ?? "—"}</td><td>{x.customer_name ?? "—"}</td><td className="mono small">{x.vehicle_plate ?? "—"}</td>
                <td className="right">{x.line_count}</td><td className="right strong">{eur(x.total)}</td><td><StatusBadge status={x.status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty icon={<Truck size={22} />} title={q || status ? "Sin coincidencias" : "Aún no hay pedidos"} action={<Link className="btn btn-primary" to="/presupuestos">Ver presupuestos</Link>}>Un pedido se crea al convertir un presupuesto aceptado.</Empty>}
      </Card>
    </>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api.get<any>(`/orders/${id}`) });
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await api.patch<any>(`/orders/${id}`, body);
      qc.setQueryData(["order", id], r);
      qc.invalidateQueries({ queryKey: ["orders"] });
      toast.ok("Pedido actualizado");
      setNotes(null);
    } catch (e) { toast.err(e); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHead title={<span className="row"><span className="mono">{d.number}</span><StatusBadge status={d.status} /></span>}
        subtitle={<>Creado {dateTime(d.created_at)}{d.quote_id && <> · desde el presupuesto <Link to={`/presupuestos/${d.quote_id}`}>ver presupuesto</Link></>}</>}
        actions={<a className="btn" href={`/api/orders/${id}/pdf`} target="_blank" rel="noreferrer"><FileDown size={16} />PDF</a>} />
      <div className="row row-wrap mb">
        <span className="small dim">Estado:</span>
        {STATUSES.map((s) => <Button key={s} size="sm" variant={d.status === s ? "primary" : "default"} disabled={d.status === s || busy} onClick={() => patch({ status: s })}>{statusLabel(s)}</Button>)}
      </div>
      <div className="grid g2 mb">
        <Card title="Cliente"><dl className="kv"><dt>Nombre</dt><dd>{d.customer_name ?? "—"}</dd><dt>Teléfono</dt><dd>{d.customer_phone ? <a href={`tel:${d.customer_phone}`}>{d.customer_phone}</a> : "—"}</dd><dt>Correo</dt><dd>{d.customer_email ?? "—"}</dd></dl></Card>
        <Card title="Vehículo"><dl className="kv"><dt>Matrícula</dt><dd className="mono">{d.vehicle_plate ?? "—"}</dd><dt>Bastidor</dt><dd className="mono">{d.vehicle_vin ?? "—"}</dd><dt>Modelo</dt><dd>{[d.vehicle_make, d.vehicle_model, d.vehicle_year].filter(Boolean).join(" ") || "—"}</dd></dl></Card>
      </div>
      <Card title="Líneas" pad={false}>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Descripción</th><th>Referencia</th><th>Estado</th><th>Proveedor</th><th className="right">Coste</th><th className="right">Precio</th><th className="right">Cant.</th><th className="right">Dto.</th><th className="right">Importe</th></tr></thead>
          <tbody>{d.lines.map((l: any, i: number) => (
            <tr key={l.id}>
              <td><div className="strong">{l.description}</div><div className="tiny dim">{l.brand}</div></td>
              <td className="mono small">{l.ref ?? "—"}{l.oem_ref && <div className="tiny dim">OEM {l.oem_ref}</div>}</td>
              <td>{l.condition ?? "—"}</td><td className="small">{l.supplier_name ?? "—"}</td>
              <td className="right">{eur(l.cost_price)}</td><td className="right">{eur(l.unit_price)}</td><td className="right">{Number(l.quantity)}</td><td className="right">{Number(l.discount_pct) ? `${Number(l.discount_pct)} %` : "—"}</td>
              <td className="right strong">{eur(d.totals.lines[i])}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      <div className="grid g2 mt">
        <Card title="Observaciones">
          <textarea className="textarea" value={notes ?? d.notes ?? ""} onChange={(e) => setNotes(e.target.value)} />
          {notes !== null && <div className="row mt"><Button variant="primary" size="sm" loading={busy} onClick={() => patch({ notes })}>Guardar observaciones</Button></div>}
        </Card>
        <Card title="Totales">
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <div className="totals">
              <span className="muted">Subtotal</span><span className="right">{eur(d.totals.subtotal)}</span>
              {Number(d.global_discount_pct) > 0 && <><span className="muted">Descuento {Number(d.global_discount_pct)} %</span><span className="right">−{eur(d.totals.discount)}</span></>}
              <span className="muted">Base imponible</span><span className="right">{eur(d.totals.base)}</span>
              <span className="muted">IVA {Number(d.vat_rate)} %</span><span className="right">{eur(d.totals.vat)}</span>
              <span className="strong">TOTAL</span><span className="right grand">{eur(d.totals.total)}</span>
              {d.totals.margin != null && <><span className="dim small">Margen bruto</span><span className="right small">{eur(d.totals.margin)}</span></>}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
