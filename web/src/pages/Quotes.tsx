import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Copy, FileDown, FileText, Plus, Save, ScanSearch, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Button, Card, Confirm, Empty, ErrorBox, Field, Loading, PageHead, SearchBox, StatusBadge, statusLabel, useDebounced, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { date, dateTime, eur } from "../lib/format";

export function QuotesPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [status, setStatus] = useState("");
  const list = useQuery({ queryKey: ["quotes", dq, status], queryFn: () => api.get<any[]>(`/quotes${qs({ q: dq, status })}`) });
  return (
    <>
      <PageHead title="Presupuestos" subtitle="Cree presupuestos desde los resultados del buscador o desde cero."
        actions={<><Link to="/buscador" className="btn"><ScanSearch size={16} />Desde el buscador</Link><Link to="/presupuestos/nuevo" className="btn btn-primary"><Plus size={16} />Nuevo presupuesto</Link></>} />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Número, cliente o matrícula" />
        <select className="select" style={{ width: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado">
          <option value="">Todos los estados</option>{["borrador", "enviado", "aceptado", "rechazado", "convertido"].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </div>
      <Card pad={false}>
        {list.isLoading ? <Loading /> : list.error ? <div className="card-body"><ErrorBox error={list.error} /></div> : list.data!.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Vehículo</th><th className="right">Líneas</th><th className="right">Base</th><th className="right">Total</th><th>Válido hasta</th><th>Estado</th></tr></thead>
            <tbody>{list.data!.map((x) => (
              <tr key={x.id} className="clickable" onClick={() => nav(`/presupuestos/${x.id}`)}>
                <td className="mono strong">{x.number}</td><td className="small">{date(x.created_at)}</td><td>{x.customer_name ?? <span className="dim">—</span>}</td><td className="mono small">{x.vehicle_plate ?? "—"}</td>
                <td className="right">{x.line_count}</td><td className="right">{eur(x.base)}</td><td className="right strong">{eur(x.total)}</td><td className="small">{date(x.valid_until)}</td><td><StatusBadge status={x.status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty icon={<FileText size={22} />} title={q || status ? "Sin coincidencias" : "Aún no hay presupuestos"} action={<Link to="/buscador" className="btn btn-primary"><ScanSearch size={16} />Buscar un recambio</Link>}>Desde cada resultado del buscador puede pulsar «Presupuesto».</Empty>}
      </Card>
    </>
  );
}

interface LineForm { description: string; brand: string; ref: string; oem_ref: string; condition: string; supplier_id: string; source_label: string; cost_price: string; margin_pct: string; unit_price: string; quantity: string; discount_pct: string }
const emptyLine: LineForm = { description: "", brand: "", ref: "", oem_ref: "", condition: "nuevo", supplier_id: "", source_label: "", cost_price: "", margin_pct: "", unit_price: "", quantity: "1", discount_pct: "0" };
const n = (v: string | number | null | undefined) => { const x = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export function calcTotals(lines: LineForm[], vat: number, gdisc: number) {
  const nets = lines.map((l) => r2(n(l.unit_price) * n(l.quantity) * (1 - n(l.discount_pct) / 100)));
  const subtotal = r2(nets.reduce((s, x) => s + x, 0));
  const discount = r2(subtotal * (gdisc / 100));
  const base = r2(subtotal - discount);
  const vatAmt = r2(base * (vat / 100));
  const costs = lines.map((l) => (l.cost_price === "" ? null : n(l.cost_price) * n(l.quantity)));
  const cost = costs.every((c) => c != null) ? r2(costs.reduce((s, c) => s + (c ?? 0), 0)) : null;
  return { nets, subtotal, discount, base, vat: vatAmt, total: r2(base + vatAmt), cost, margin: cost != null ? r2(base - cost) : null };
}

export function QuoteEditor() {
  const { id } = useParams();
  const isNew = id === "nuevo";
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["quote", id], queryFn: () => api.get<any>(`/quotes/${id}`), enabled: !isNew });
  const company = useQuery({ queryKey: ["company"], queryFn: () => api.get<any>("/settings/company") });
  const customers = useQuery({ queryKey: ["customers", ""], queryFn: () => api.get<any[]>("/customers") });
  const vehicles = useQuery({ queryKey: ["vehicles", ""], queryFn: () => api.get<any[]>("/vehicles") });
  const suppliers = useQuery({ queryKey: ["suppliers", ""], queryFn: () => api.get<any[]>("/suppliers") });
  const [head, setHead] = useState({ customer_id: params.get("customer") ?? "", vehicle_id: "", vat_rate: "21", global_discount_pct: "0", valid_until: "", notes: "" });
  const [lines, setLines] = useState<LineForm[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [del, setDel] = useState(false);
  const [convert, setConvert] = useState(false);

  useEffect(() => {
    if (q.data) {
      const d = q.data;
      setHead({ customer_id: d.customer_id ?? "", vehicle_id: d.vehicle_id ?? "", vat_rate: String(d.vat_rate), global_discount_pct: String(d.global_discount_pct), valid_until: d.valid_until?.slice(0, 10) ?? "", notes: d.notes ?? "" });
      setLines(d.lines.map((l: any) => Object.fromEntries(Object.keys(emptyLine).map((k) => [k, l[k] == null ? "" : String(l[k])])) as unknown as LineForm));
      setDirty(false);
    }
  }, [q.data]);
  useEffect(() => {
    if (isNew && company.data) {
      setHead((h) => ({ ...h, vat_rate: String(company.data.defaultVat), valid_until: new Date(Date.now() + company.data.quoteValidityDays * 86400000).toISOString().slice(0, 10) }));
      setLines([{ ...emptyLine, margin_pct: String(company.data.defaultMargin) }]);
    }
  }, [isNew, company.data]);

  const t = useMemo(() => calcTotals(lines, n(head.vat_rate), n(head.global_discount_pct)), [lines, head]);
  const d = q.data;
  const locked = d?.status === "convertido";
  const setH = (k: keyof typeof head) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => { setHead({ ...head, [k]: e.target.value }); setDirty(true); };
  const setL = (i: number, k: keyof LineForm, v: string) => {
    setLines(lines.map((l, j) => {
      if (j !== i) return l;
      const nl = { ...l, [k]: v };
      if ((k === "cost_price" || k === "margin_pct") && nl.cost_price !== "" && nl.margin_pct !== "") nl.unit_price = String(r2(n(nl.cost_price) * (1 + n(nl.margin_pct) / 100)));
      return nl;
    }));
    setDirty(true);
  };

  async function save() {
    setBusy(true);
    setErr(null);
    const body = {
      ...head, customer_id: head.customer_id || null, vehicle_id: head.vehicle_id || null,
      lines: lines.filter((l) => l.description.trim()).map((l) => ({ ...l, supplier_id: l.supplier_id || null, condition: l.condition || null })),
    };
    try {
      const r = isNew ? await api.post<any>("/quotes", body) : await api.put<any>(`/quotes/${id}`, body);
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.setQueryData(["quote", r.id], r);
      toast.ok("Presupuesto guardado");
      setDirty(false);
      if (isNew) nav(`/presupuestos/${r.id}`, { replace: true });
      return r;
    } catch (e) { setErr(e); throw e; } finally { setBusy(false); }
  }
  async function setStatus(s: string) {
    try {
      if (dirty) await save();
      const r = await api.patch<any>(`/quotes/${id}/status`, { status: s });
      qc.setQueryData(["quote", id], { ...r, order: d?.order });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      toast.ok(`Estado: ${statusLabel(s)}`);
    } catch (e) { toast.err(e); }
  }
  async function duplicate() {
    try {
      const r = await api.post<any>(`/quotes/${id}/duplicate`);
      qc.invalidateQueries({ queryKey: ["quotes"] });
      nav(`/presupuestos/${r.id}`);
      toast.ok(`Creado ${r.number}`);
    } catch (e) { toast.err(e); }
  }

  if (!isNew && q.isLoading) return <Loading />;
  if (!isNew && q.error) return <ErrorBox error={q.error} />;

  return (
    <>
      <PageHead
        title={<span className="row">{isNew ? "Nuevo presupuesto" : <span className="mono">{d.number}</span>}{d && <StatusBadge status={d.status} />}</span>}
        subtitle={d ? `Creado ${dateTime(d.created_at)} por ${d.created_by_name ?? "—"}` : "Las líneas se pueden añadir también desde el buscador."}
        actions={<>
          {!isNew && <a className="btn" href={`/api/quotes/${id}/pdf`} target="_blank" rel="noreferrer" onClick={(e) => { if (dirty) { e.preventDefault(); toast.err(new Error("Guarde los cambios antes de generar el PDF")); } }}><FileDown size={16} />PDF</a>}
          {!isNew && <Button icon={<Copy size={16} />} onClick={duplicate}>Duplicar</Button>}
          {!locked && <Button variant="primary" icon={<Save size={16} />} loading={busy} onClick={() => save().catch(() => {})} disabled={!dirty && !isNew}>Guardar</Button>}
        </>}
      />
      {locked && d.order && <Alert tone="lime">Convertido en el pedido <Link to={`/pedidos/${d.order.id}`}>{d.order.number}</Link>. Ya no se puede modificar.</Alert>}
      {!isNew && !locked && (
        <div className="row row-wrap mb mt">
          <span className="small dim">Cambiar estado:</span>
          {["borrador", "enviado", "aceptado", "rechazado"].map((s) => <Button key={s} size="sm" variant={d.status === s ? "primary" : "default"} onClick={() => setStatus(s)} disabled={d.status === s}>{statusLabel(s)}</Button>)}
          <div className="grow" />
          <Button size="sm" variant="primary" icon={<ArrowRightLeft size={14} />} disabled={d.status !== "aceptado"} title={d.status !== "aceptado" ? "Marque el presupuesto como aceptado para convertirlo" : ""} onClick={() => setConvert(true)}>Convertir en pedido</Button>
          {user?.role === "admin" && <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => setDel(true)}>Eliminar</Button>}
        </div>
      )}
      <div className="stack">
        <Card>
          <div className="grid g4">
            <Field label="Cliente" className="span2">
              <select className="select" value={head.customer_id} onChange={setH("customer_id")} disabled={locked}><option value="">Sin cliente</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </Field>
            <Field label="Vehículo" className="span2">
              <select className="select" value={head.vehicle_id} onChange={setH("vehicle_id")} disabled={locked}><option value="">Sin vehículo</option>{vehicles.data?.map((v) => <option key={v.id} value={v.id}>{[v.plate ?? v.vin, v.make, v.model].filter(Boolean).join(" · ")}</option>)}</select>
            </Field>
            <Field label="IVA %"><input className="input" inputMode="decimal" value={head.vat_rate} onChange={setH("vat_rate")} disabled={locked} /></Field>
            <Field label="Descuento global %"><input className="input" inputMode="decimal" value={head.global_discount_pct} onChange={setH("global_discount_pct")} disabled={locked} /></Field>
            <Field label="Válido hasta"><input className="input" type="date" value={head.valid_until} onChange={setH("valid_until")} disabled={locked} /></Field>
          </div>
        </Card>
        <Card title="Líneas" pad={false} actions={!locked && <Button size="sm" icon={<Plus size={14} />} onClick={() => { setLines([...lines, { ...emptyLine, margin_pct: String(company.data?.defaultMargin ?? "") }]); setDirty(true); }}>Añadir línea</Button>}>
          <div className="table-wrap">
            <table className="table lines-table">
              <thead><tr><th style={{ minWidth: 220 }}>Descripción</th><th>Fabricante</th><th>Referencia</th><th>Ref. OEM</th><th>Estado</th><th>Proveedor</th><th>Coste</th><th>Margen %</th><th>Precio</th><th>Cant.</th><th>Dto. %</th><th className="right">Importe</th><th></th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td><input className="input" value={l.description} onChange={(e) => setL(i, "description", e.target.value)} disabled={locked} aria-label="Descripción" /></td>
                    <td><input className="input" style={{ width: 100 }} value={l.brand} onChange={(e) => setL(i, "brand", e.target.value)} disabled={locked} aria-label="Fabricante" /></td>
                    <td><input className="input mono" style={{ width: 120 }} value={l.ref} onChange={(e) => setL(i, "ref", e.target.value)} disabled={locked} aria-label="Referencia" /></td>
                    <td><input className="input mono" style={{ width: 120 }} value={l.oem_ref} onChange={(e) => setL(i, "oem_ref", e.target.value)} disabled={locked} aria-label="Referencia OEM" /></td>
                    <td><select className="select" style={{ width: 96, height: 32 }} value={l.condition} onChange={(e) => setL(i, "condition", e.target.value)} disabled={locked} aria-label="Estado"><option value="nuevo">Nuevo</option><option value="usado">Usado</option></select></td>
                    <td><select className="select" style={{ width: 140, height: 32 }} value={l.supplier_id} onChange={(e) => setL(i, "supplier_id", e.target.value)} disabled={locked} aria-label="Proveedor"><option value="">—</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                    <td><input className="input" style={{ width: 80 }} inputMode="decimal" value={l.cost_price} onChange={(e) => setL(i, "cost_price", e.target.value)} disabled={locked} aria-label="Coste" /></td>
                    <td><input className="input" style={{ width: 64 }} inputMode="decimal" value={l.margin_pct} onChange={(e) => setL(i, "margin_pct", e.target.value)} disabled={locked} aria-label="Margen" /></td>
                    <td><input className="input" style={{ width: 84 }} inputMode="decimal" value={l.unit_price} onChange={(e) => setL(i, "unit_price", e.target.value)} disabled={locked} aria-label="Precio" /></td>
                    <td><input className="input" style={{ width: 56 }} inputMode="decimal" value={l.quantity} onChange={(e) => setL(i, "quantity", e.target.value)} disabled={locked} aria-label="Cantidad" /></td>
                    <td><input className="input" style={{ width: 56 }} inputMode="decimal" value={l.discount_pct} onChange={(e) => setL(i, "discount_pct", e.target.value)} disabled={locked} aria-label="Descuento" /></td>
                    <td className="right strong nowrap">{eur(t.nets[i])}</td>
                    <td>{!locked && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} onClick={() => { setLines(lines.filter((_, j) => j !== i)); setDirty(true); }} aria-label="Quitar línea" />}</td>
                  </tr>
                ))}
                {!lines.length && <tr><td colSpan={13} className="dim small" style={{ padding: 20, textAlign: "center" }}>Sin líneas. Añada una o use «Presupuesto» desde el buscador.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="grid g2">
          <Card title="Observaciones"><textarea className="textarea" style={{ minHeight: 120 }} value={head.notes} onChange={setH("notes")} disabled={locked} placeholder="Plazo de entrega, garantía de piezas usadas, condiciones…" /></Card>
          <Card title="Totales">
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <div className="totals">
                <span className="muted">Subtotal</span><span className="right">{eur(t.subtotal)}</span>
                {n(head.global_discount_pct) > 0 && <><span className="muted">Descuento {n(head.global_discount_pct)} %</span><span className="right">−{eur(t.discount)}</span></>}
                <span className="muted">Base imponible</span><span className="right">{eur(t.base)}</span>
                <span className="muted">IVA {n(head.vat_rate)} %</span><span className="right">{eur(t.vat)}</span>
                <span className="strong">TOTAL</span><span className="right grand">{eur(t.total)}</span>
                <span className="dim small">Margen bruto</span><span className="right small">{t.margin != null ? `${eur(t.margin)} (${t.base ? Math.round((t.margin / t.base) * 1000) / 10 : 0} %)` : "Falta el coste de alguna línea"}</span>
              </div>
            </div>
          </Card>
        </div>
        <ErrorBox error={err} />
      </div>
      {del && <Confirm title="Eliminar presupuesto" danger confirmLabel="Eliminar" message={`Se eliminará ${d.number}.`} onClose={() => setDel(false)}
        onConfirm={async () => { await api.del(`/quotes/${id}`); qc.invalidateQueries({ queryKey: ["quotes"] }); nav("/presupuestos"); }} />}
      {convert && <Confirm title="Convertir en pedido" confirmLabel="Crear pedido" message={<>Se creará un pedido con las {lines.length} líneas de {d.number}. El presupuesto quedará bloqueado.</>} onClose={() => setConvert(false)}
        onConfirm={async () => { if (dirty) await save(); const o = await api.post<any>(`/quotes/${id}/convert`); qc.invalidateQueries({ queryKey: ["quotes"] }); qc.invalidateQueries({ queryKey: ["orders"] }); toast.ok(`Pedido ${o.number} creado`); nav(`/pedidos/${o.id}`); }} />}
    </>
  );
}
