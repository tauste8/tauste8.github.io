import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Boxes, Car, Clock, Database, FileText, Layers, Package, Plug, Recycle, ScanSearch, Sparkles, Timer, Truck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Badge, Card, Empty, Kpi, Loading, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { ago, ms, num } from "../lib/format";

export function DashboardPage() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<any>("/stats/dashboard"), refetchInterval: 60_000 });
  if (q.isLoading) return <Loading rows={6} />;
  if (q.error) return <Alert tone="red">{(q.error as Error).message}</Alert>;
  const d = q.data;
  const cat = d.catalog;
  const noData = cat.oem + cat.iam + cat.offers_new + cat.offers_used + cat.inventory === 0;
  const hour = new Date().getHours();
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div>
          <h1>{hour < 14 ? "Buenos días" : hour < 21 ? "Buenas tardes" : "Buenas noches"}, {d.user.split(" ")[0]}</h1>
          <p>Resumen de actividad y estado de las fuentes de datos.</p>
        </div>
        <Link to="/buscador" className="btn btn-primary btn-lg"><ScanSearch size={18} />Buscar recambio</Link>
      </div>

      {noData && (
        <Alert tone="amber">
          <b>Todavía no hay datos de catálogo.</b> El buscador solo muestra información real: importe tarifas de proveedores, stock de centros CAT y tablas de equivalencias en{" "}
          <Link to="/integraciones">Integraciones</Link>, o registre piezas en <Link to="/inventario">Inventario</Link>.
        </Alert>
      )}

      <div className="grid g4">
        <Kpi icon={<ScanSearch size={14} />} label="Búsquedas hoy" value={num(d.today.searches)} sub={d.today.searches ? `${Math.round((d.today.ok / d.today.searches) * 100)} % con resultado` : "Sin búsquedas todavía"} />
        <Kpi icon={<Timer size={14} />} label="Tiempo medio hoy" value={d.today.searches ? ms(d.today.avg_ms) : "—"} sub="Desde BUSCAR hasta resultados" />
        <Kpi icon={<FileText size={14} />} label="Presupuestos abiertos" value={num(d.pendingQuotes.length)} sub="Borrador o enviados" />
        <Kpi icon={<Truck size={14} />} label="Pedidos en curso" value={num(d.openOrders.length)} sub="Pendientes de entregar" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }}>
        <Card title="Últimas búsquedas" icon={<Clock size={16} color="var(--lime)" />} pad={false} actions={<Link to="/historial" className="btn btn-sm btn-ghost">Ver historial</Link>}>
          {d.recent.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Vehículo</th><th>Pieza / referencia</th><th>Resultados</th><th>Usuario</th><th></th></tr></thead>
                <tbody>
                  {d.recent.map((s: any) => (
                    <tr key={s.id} className="clickable" onClick={() => nav(`/buscador?h=${s.id}`)}>
                      <td><div className="mono strong">{s.plate ?? s.vin ?? s.query_vehicle ?? "—"}</div><div className="tiny dim">{[s.make, s.model].filter(Boolean).join(" ")}</div></td>
                      <td>{s.part_name ?? s.query_part ?? s.query_ref ?? "—"}</td>
                      <td><span className="row" style={{ gap: 6 }}><Badge>A {s.count_oem}</Badge><Badge>B {s.count_iam}</Badge><Badge>C {s.count_cat}</Badge></span></td>
                      <td className="small muted">{s.user_name}</td>
                      <td className="right small dim nowrap">{ago(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon={<ScanSearch size={22} />} title="Aún no se ha buscado nada" action={<Link to="/buscador" className="btn btn-primary">Hacer la primera búsqueda</Link>}>Las búsquedas de todo el equipo aparecerán aquí.</Empty>}
        </Card>

        <Card title="Datos disponibles para el buscador" icon={<Database size={16} color="var(--lime)" />}>
          <div className="stack" style={{ gap: 10 }}>
            {[
              [<Layers size={15} />, "Referencias OEM", cat.oem, "/oem"],
              [<Package size={15} />, "Equivalencias IAM", cat.iam, "/iam"],
              [<Truck size={15} />, "Ofertas de recambio nuevo", cat.offers_new, "/integraciones"],
              [<Recycle size={15} />, "Piezas usadas CAT", cat.offers_used, "/cat"],
              [<Boxes size={15} />, "Piezas en inventario", cat.inventory, "/inventario"],
              [<Car size={15} />, "Vehículos registrados", cat.vehicles, "/vehiculos"],
            ].map(([icon, label, n, to]) => (
              <Link key={label as string} to={to as string} className="row between" style={{ color: "inherit", textDecoration: "none" }}>
                <span className="row muted">{icon}{label}</span>
                <b style={{ color: n ? "var(--text)" : "var(--amber)" }}>{num(n as number)}</b>
              </Link>
            ))}
            <div className="row between" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <span className="row muted"><Sparkles size={15} />Asistente IA</span>
              {d.ai ? <Badge tone="lime">Activo</Badge> : <Badge>No configurado</Badge>}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Presupuestos abiertos" icon={<FileText size={16} color="var(--lime)" />} pad={false} actions={<Link to="/presupuestos" className="btn btn-sm btn-ghost">Todos</Link>}>
          {d.pendingQuotes.length ? (
            <table className="table"><tbody>{d.pendingQuotes.map((x: any) => (
              <tr key={x.id} className="clickable" onClick={() => nav(`/presupuestos/${x.id}`)}><td className="mono nowrap">{x.number}</td><td className="small">{x.customer_name ?? "—"}</td><td className="right"><StatusBadge status={x.status} /></td></tr>
            ))}</tbody></table>
          ) : <Empty icon={<FileText size={20} />} title="Sin presupuestos abiertos">Cree presupuestos desde los resultados del buscador.</Empty>}
        </Card>
        <Card title="Pedidos en curso" icon={<Truck size={16} color="var(--lime)" />} pad={false} actions={<Link to="/pedidos" className="btn btn-sm btn-ghost">Todos</Link>}>
          {d.openOrders.length ? (
            <table className="table"><tbody>{d.openOrders.map((x: any) => (
              <tr key={x.id} className="clickable" onClick={() => nav(`/pedidos/${x.id}`)}><td className="mono nowrap">{x.number}</td><td className="small">{x.customer_name ?? "—"}</td><td className="right"><StatusBadge status={x.status} /></td></tr>
            ))}</tbody></table>
          ) : <Empty icon={<Truck size={20} />} title="Sin pedidos en curso">Los presupuestos aceptados se convierten en pedidos.</Empty>}
        </Card>
        <Card title="Estado de integraciones" icon={<Plug size={16} color="var(--lime)" />} pad={false} actions={<Link to="/integraciones" className="btn btn-sm btn-ghost">Gestionar</Link>}>
          <table className="table"><tbody>{d.sources.slice(0, 7).map((s: any, i: number) => (
            <tr key={i}><td className="small">{s.name}</td><td className="right"><StatusBadge status={s.connector_key === "archivo" && s.status === "sin_datos" ? "sin_datos" : s.status} /></td></tr>
          ))}</tbody></table>
        </Card>
      </div>

      {d.lowStock.length > 0 && (
        <Card title="Inventario con stock bajo" icon={<AlertTriangle size={16} color="var(--amber)" />} pad={false}>
          <table className="table"><tbody>{d.lowStock.map((x: any) => (
            <tr key={x.id} className="clickable" onClick={() => nav(`/inventario?id=${x.id}`)}><td>{x.description}</td><td className="small muted">{x.location ?? "—"}</td><td className="right"><Badge tone={x.quantity ? "amber" : "red"}>{x.quantity} ud.</Badge></td></tr>
          ))}</tbody></table>
        </Card>
      )}
    </div>
  );
}
