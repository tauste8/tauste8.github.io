import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clock, Database, FileText, Percent, ScanSearch, Truck } from "lucide-react";
import { useState } from "react";
import { Card, Empty, ErrorBox, Kpi, Loading, PageHead } from "../components/ui";
import { api } from "../lib/api";
import { eur, ms, num } from "../lib/format";

function BarList({ rows, empty }: { rows: { label: string; value: number; sub?: string }[]; empty: string }) {
  if (!rows.length) return <div className="small dim" style={{ padding: 8 }}>{empty}</div>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {rows.map((r, i) => (
        <div key={i} title={`${r.label}: ${num(r.value)}`}>
          <div className="row between small"><span className="truncate">{r.label}{r.sub && <span className="dim"> · {r.sub}</span>}</span><b>{num(r.value)}</b></div>
          <div className="bar" style={{ marginTop: 4 }}><div style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function DailyChart({ data }: { data: { day: string; n: number; ok: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <Empty icon={<BarChart3 size={20} />} title="Sin búsquedas en el periodo" />;
  const max = Math.max(...data.map((d) => d.n), 1);
  const W = 100 / data.length;
  const h = hover != null ? data[hover] : null;
  return (
    <div>
      <div className="small muted" style={{ height: 20 }}>{h ? <>{new Date(h.day).toLocaleDateString("es-ES")} · <b style={{ color: "var(--text)" }}>{h.n} búsquedas</b> · {h.ok} con resultado</> : "Pase el cursor sobre una barra para ver el detalle"}</div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: "100%", height: 180, display: "block" }} role="img" aria-label="Búsquedas por día" onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="100" y1={40 - g * 38} y2={40 - g * 38} stroke="var(--line)" strokeWidth="0.15" />)}
        {data.map((d, i) => {
          const bh = (d.n / max) * 38;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={i * W} y={0} width={W} height={40} fill="transparent" />
              <rect x={i * W + W * 0.15} y={40 - bh} width={W * 0.7} height={bh} rx={0.6} fill={hover === i ? "var(--lime-2)" : "var(--lime)"} opacity={hover == null || hover === i ? 1 : 0.55} />
            </g>
          );
        })}
      </svg>
      <div className="row between tiny dim"><span>{new Date(data[0].day).toLocaleDateString("es-ES")}</span><span>máx. {max}/día</span><span>{new Date(data[data.length - 1].day).toLocaleDateString("es-ES")}</span></div>
    </div>
  );
}

export function StatsPage() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["stats", days], queryFn: () => api.get<any>(`/stats?days=${days}`) });
  return (
    <>
      <PageHead title="Estadísticas" subtitle="Actividad del buscador, catálogo y ventas."
        actions={<select className="select" style={{ width: 180 }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Periodo">
          <option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option><option value={365}>Último año</option>
        </select>} />
      {q.isLoading ? <Loading rows={6} /> : q.error ? <ErrorBox error={q.error} /> : (() => {
        const s = q.data;
        return (
          <div className="stack">
            <div className="grid g4">
              <Kpi icon={<ScanSearch size={14} />} label="Búsquedas realizadas" value={num(s.summary.total)} sub={`${num(s.summary.incomplete)} incompletas (falta vehículo o pieza)`} />
              <Kpi icon={<Percent size={14} />} label="Búsquedas con resultado" value={s.summary.success_rate != null ? `${s.summary.success_rate} %` : "—"} sub={`${num(s.summary.with_results)} con resultado · ${num(s.summary.without_results)} sin resultado`} />
              <Kpi icon={<Clock size={14} />} label="Tiempo medio de búsqueda" value={s.summary.total ? ms(s.summary.avg_ms) : "—"} sub="Tiempo de proceso en el servidor" />
              <Kpi icon={<FileText size={14} />} label="Presupuestos" value={num(s.sales.quotes)} sub={`${num(s.sales.quotes_accepted)} aceptados · ${eur(s.sales.quoted_base)} presupuestado`} />
            </div>
            <div className="grid g4">
              <Kpi icon={<Truck size={14} />} label="Pedidos" value={num(s.sales.orders)} sub="No cancelados" />
              <Kpi icon={<Truck size={14} />} label="Ventas (base imponible)" value={eur(s.sales.revenue_base)} sub="Suma de pedidos del periodo" />
              <Kpi icon={<Database size={14} />} label="Inventario" value={num(s.catalog.inventory_units)} sub={`${num(s.catalog.inventory)} referencias · ${eur(s.catalog.inventory_value)} a coste`} />
              <Kpi icon={<Database size={14} />} label="Catálogo cargado" value={num(s.catalog.oem + s.catalog.iam)} sub={`${num(s.catalog.oem)} OEM · ${num(s.catalog.iam)} IAM · ${num(s.catalog.offers_new + s.catalog.offers_used)} ofertas`} />
            </div>
            <Card title="Búsquedas por día"><DailyChart data={s.perDay} /></Card>
            <div className="grid g3">
              <Card title="Piezas más solicitadas"><BarList rows={s.topParts.map((p: any) => ({ label: p.name, value: p.n }))} empty="Sin datos en el periodo" /></Card>
              <Card title="Vehículos más consultados"><BarList rows={s.topVehicles.map((v: any) => ({ label: v.plate ?? [v.make, v.model].filter(Boolean).join(" ") ?? "—", sub: [v.make, v.model, v.engine_code].filter(Boolean).join(" "), value: v.n }))} empty="Sin datos en el periodo" /></Card>
              <Card title="Referencias OEM más frecuentes"><BarList rows={s.topRefs.map((r: any) => ({ label: r.ref, value: r.n }))} empty="Sin datos en el periodo" /></Card>
              <Card title="Proveedores más utilizados"><BarList rows={s.suppliersUsed.map((r: any) => ({ label: r.name, sub: eur(r.cost), value: r.n }))} empty="Sin pedidos en el periodo" /></Card>
              <Card title="Búsquedas por usuario"><BarList rows={s.users.map((r: any) => ({ label: r.name, value: r.n }))} empty="Sin datos en el periodo" /></Card>
            </div>
          </div>
        );
      })()}
    </>
  );
}
