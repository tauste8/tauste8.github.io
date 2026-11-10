import {
  BarChart3, Boxes, Building2, Car, ClipboardList, Cog, FileText, Gauge, History, Layers, LogOut, Menu, Plug, Recycle, ScanSearch, Truck, Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button } from "./ui";

export const NAV = [
  { to: "/", label: "Dashboard", icon: Gauge, group: "Principal" },
  { to: "/buscador", label: "Buscador inteligente", icon: ScanSearch, group: "Principal", primary: true },
  { to: "/vehiculos", label: "Vehículos", icon: Car, group: "Catálogo" },
  { to: "/inventario", label: "Inventario", icon: Boxes, group: "Catálogo" },
  { to: "/oem", label: "Referencias OEM", icon: Layers, group: "Catálogo" },
  { to: "/iam", label: "Equivalencias IAM", icon: ClipboardList, group: "Catálogo" },
  { to: "/cat", label: "Recambios usados CAT", icon: Recycle, group: "Catálogo" },
  { to: "/clientes", label: "Clientes", icon: Users, group: "Comercial" },
  { to: "/proveedores", label: "Proveedores", icon: Building2, group: "Comercial" },
  { to: "/presupuestos", label: "Presupuestos", icon: FileText, group: "Comercial" },
  { to: "/pedidos", label: "Pedidos", icon: Truck, group: "Comercial" },
  { to: "/historial", label: "Historial de búsquedas", icon: History, group: "Análisis" },
  { to: "/estadisticas", label: "Estadísticas", icon: BarChart3, group: "Análisis" },
  { to: "/integraciones", label: "Integraciones", icon: Plug, group: "Sistema" },
  { to: "/configuracion", label: "Configuración", icon: Cog, group: "Sistema" },
];

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden>
      <rect width="512" height="512" rx="112" fill="#111614" />
      <g fill="none" stroke="#A5FF5F" strokeWidth="34" strokeLinecap="round" strokeLinejoin="round">
        <path d="M256 104 L384 400" /><path d="M256 104 L128 400" /><path d="M178 290 L334 290" />
      </g>
      <circle cx="256" cy="104" r="24" fill="#A5FF5F" />
    </svg>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const current = NAV.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to)));
  let lastGroup = "";
  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <Logo />
          <div>
            <div className="brand-name">AUTORECA <span>IA</span></div>
            <div className="brand-sub">Recambios inteligentes</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => {
            const head = n.group !== lastGroup ? <div className="nav-group">{n.group}</div> : null;
            lastGroup = n.group;
            const I = n.icon;
            return (
              <div key={n.to}>
                {head}
                <NavLink to={n.to} end={n.to === "/"} className={({ isActive }) => `${isActive ? "active" : ""} ${n.primary ? "primary-link" : ""}`}>
                  <I size={17} />
                  {n.label}
                </NavLink>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="avatar">{user?.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</div>
            <div className="grow">
              <div className="strong truncate small">{user?.name}</div>
              <div className="tiny dim">{user?.role === "admin" ? "Administrador" : "Trabajador"}</div>
            </div>
            <Button variant="ghost" size="sm" iconOnly icon={<LogOut size={16} />} onClick={logout} title="Cerrar sesión" aria-label="Cerrar sesión" />
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Button className="menu-btn" variant="ghost" iconOnly icon={<Menu size={20} />} onClick={() => setOpen(true)} aria-label="Abrir menú" />
          <div className="crumb">AUTORECA IA / <b>{current?.label ?? ""}</b></div>
          <div className="grow" />
          {loc.pathname !== "/buscador" && loc.pathname !== "/" && (
            <NavLink to="/buscador" className="btn btn-primary btn-sm"><ScanSearch size={15} />Buscar recambio</NavLink>
          )}
        </header>
        <main className="content" key={loc.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
