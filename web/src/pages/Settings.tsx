import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building, Copy, Download, KeyRound, LogOut, Plus, Server, ShieldCheck, Trash2, UserCog, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, ErrorBox, Field, Loading, Modal, PageHead, Tabs, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ago, dateTime } from "../lib/format";
import { usePartTypes } from "./Search";

type Tab = "empresa" | "usuarios" | "sinonimos" | "cuenta" | "sistema";

export function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<Tab>(isAdmin ? "empresa" : "cuenta");
  const items: { value: Tab; label: string }[] = [
    ...(isAdmin ? [{ value: "empresa" as Tab, label: "Empresa" }, { value: "usuarios" as Tab, label: "Usuarios" }] : []),
    { value: "sinonimos", label: "Sinónimos de piezas" },
    { value: "cuenta", label: "Mi cuenta" },
    ...(isAdmin ? [{ value: "sistema" as Tab, label: "Sistema y seguridad" }] : []),
  ];
  return (
    <>
      <PageHead title="Configuración" subtitle="Datos de la empresa, usuarios, seguridad y copias de seguridad." />
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab === "empresa" && <Company />}
      {tab === "usuarios" && <UsersAdmin />}
      {tab === "sinonimos" && <Synonyms />}
      {tab === "cuenta" && <Account />}
      {tab === "sistema" && <SystemTab />}
    </>
  );
}

function Company() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["company"], queryFn: () => api.get<any>("/settings/company") });
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  if (!f) return <Loading />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.put("/settings/company", f);
      qc.invalidateQueries({ queryKey: ["company"] });
      toast.ok("Datos de empresa guardados");
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Card title="Datos de la empresa" icon={<Building size={16} color="var(--lime)" />} actions={<Button variant="primary" loading={busy} onClick={save}>Guardar</Button>}>
      <div className="grid g3">
        <Field label="Razón social" className="span2"><input className="input" value={f.name} onChange={set("name")} /></Field>
        <Field label="CIF / NIF"><input className="input" value={f.taxId} onChange={set("taxId")} /></Field>
        <Field label="Dirección" className="span2"><input className="input" value={f.address} onChange={set("address")} /></Field>
        <Field label="Teléfono"><input className="input" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Correo"><input className="input" value={f.email} onChange={set("email")} /></Field>
        <Field label="IVA por defecto %"><input className="input" inputMode="decimal" value={f.defaultVat} onChange={set("defaultVat")} /></Field>
        <Field label="Margen por defecto %" hint="Se aplica al añadir piezas al presupuesto"><input className="input" inputMode="decimal" value={f.defaultMargin} onChange={set("defaultMargin")} /></Field>
        <Field label="Validez de presupuestos (días)"><input className="input" inputMode="numeric" value={f.quoteValidityDays} onChange={set("quoteValidityDays")} /></Field>
        <Field label="Pie de presupuesto (PDF)" className="span-all"><textarea className="textarea" value={f.quoteFooter} onChange={set("quoteFooter")} placeholder="Condiciones de garantía, datos bancarios, protección de datos…" /></Field>
      </div>
      <ErrorBox error={err} />
    </Card>
  );
}

function UsersAdmin() {
  const toast = useToast();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["users"], queryFn: () => api.get<any[]>("/users") });
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  async function patch(u: any, body: any) {
    try { await api.patch(`/users/${u.id}`, body); q.refetch(); toast.ok("Usuario actualizado"); } catch (e) { toast.err(e); }
  }
  async function resetLink(u: any) {
    try { const r = await api.post<{ url: string }>(`/users/${u.id}/reset-link`); setLink(r.url); } catch (e) { toast.err(e); }
  }
  return (
    <Card title="Usuarios" icon={<Users size={16} color="var(--lime)" />} pad={false} actions={<Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setCreating(true)}>Nuevo usuario</Button>}>
      {q.isLoading ? <Loading /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead>
          <tbody>{q.data?.map((u) => (
            <tr key={u.id}>
              <td className="strong">{u.name}{u.id === user?.id && <span className="tiny dim"> (usted)</span>}</td>
              <td className="small">{u.email}</td>
              <td>
                <select className="select" style={{ width: 160, height: 32 }} value={u.role} disabled={u.id === user?.id} onChange={(e) => patch(u, { role: e.target.value })} aria-label="Rol">
                  <option value="worker">Trabajador</option><option value="admin">Administrador</option>
                </select>
              </td>
              <td>{u.active ? <Badge tone="lime" dot>Activo</Badge> : <Badge tone="red" dot>Desactivado</Badge>}</td>
              <td className="small">{ago(u.last_login_at)}</td>
              <td className="right nowrap">
                <Button size="sm" variant="ghost" icon={<KeyRound size={14} />} onClick={() => resetLink(u)}>Enlace de contraseña</Button>
                {u.id !== user?.id && <Button size="sm" variant={u.active ? "danger" : "default"} onClick={() => patch(u, { active: !u.active })}>{u.active ? "Desactivar" : "Activar"}</Button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="card-body tiny dim">Los trabajadores pueden buscar, presupuestar y gestionar clientes e inventario. Eliminar registros, importar catálogos y configurar integraciones requiere rol de administrador.</div>
      {creating && <NewUser onClose={() => { setCreating(false); q.refetch(); }} />}
      {link && (
        <Modal title="Enlace para restablecer contraseña" onClose={() => setLink(null)} footer={<Button variant="primary" onClick={() => setLink(null)}>Hecho</Button>}>
          <div className="stack">
            <Alert tone="amber">Válido durante 1 hora y de un solo uso. Entréguelo al usuario por un canal seguro.</Alert>
            <div className="row"><input className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} /><Button iconOnly icon={<Copy size={16} />} onClick={() => { navigator.clipboard?.writeText(link); toast.ok("Copiado"); }} aria-label="Copiar" /></div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function NewUser({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", email: "", role: "worker", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function save() {
    setBusy(true);
    setErr(null);
    try { await api.post("/users", f); toast.ok("Usuario creado"); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title="Nuevo usuario" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Crear</Button></>}>
      <div className="grid g2">
        <Field label="Nombre"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Correo"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Rol"><select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="worker">Trabajador</option><option value="admin">Administrador</option></select></Field>
        <Field label="Contraseña inicial" hint="Mín. 10 caracteres con letras y números"><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <div className="span2"><ErrorBox error={err} /></div>
      </div>
    </Modal>
  );
}

function Synonyms() {
  const toast = useToast();
  const { user } = useAuth();
  const parts = usePartTypes();
  const q = useQuery({ queryKey: ["synonyms"], queryFn: () => api.get<any[]>("/settings/synonyms") });
  const [term, setTerm] = useState("");
  const [code, setCode] = useState("");
  async function add() {
    try { await api.post("/settings/synonyms", { term, part_code: code }); setTerm(""); q.refetch(); toast.ok("Sinónimo añadido"); } catch (e) { toast.err(e); }
  }
  return (
    <div className="grid g2">
      <Card title="Añadir denominación propia">
        <div className="stack">
          <p className="small muted">Enseñe al buscador cómo llaman las piezas sus clientes y trabajadores (por ejemplo «burro» → Motor de arranque). Se aplica de inmediato a todo el equipo.</p>
          <Field label="Término"><input className="input" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="burro" /></Field>
          <Field label="Corresponde a"><select className="select" value={code} onChange={(e) => setCode(e.target.value)}><option value="">Seleccione…</option>{parts.data?.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
          <Button variant="primary" disabled={!term || !code} onClick={add}>Añadir</Button>
        </div>
      </Card>
      <Card title="Sinónimos de la empresa" pad={false}>
        {q.data?.length ? <table className="table"><tbody>{q.data.map((s) => (
          <tr key={s.id}><td className="strong">{s.term}</td><td>→ {s.part_name}</td><td className="small dim">{s.user_name}</td>
            <td className="right">{user?.role === "admin" && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} onClick={async () => { await api.del(`/settings/synonyms/${s.id}`); q.refetch(); }} aria-label="Eliminar" />}</td></tr>
        ))}</tbody></table> : <div className="card-body small dim">Sin sinónimos propios. El diccionario base reconoce 60 tipos de pieza y más de 230 denominaciones.</div>}
      </Card>
    </div>
  );
}

function Account() {
  const toast = useToast();
  const { user, logout } = useAuth();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api.get<any[]>("/auth/sessions") });
  const [f, setF] = useState({ current: "", password: "", password2: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function change() {
    if (f.password !== f.password2) return setErr(new Error("Las contraseñas no coinciden"));
    setBusy(true);
    setErr(null);
    try { await api.post("/auth/change-password", { current: f.current, password: f.password }); toast.ok("Contraseña cambiada. Se han cerrado sus otras sesiones."); setF({ current: "", password: "", password2: "" }); sessions.refetch(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <div className="grid g2">
      <Card title="Cambiar contraseña" icon={<KeyRound size={16} color="var(--lime)" />}>
        <div className="stack">
          <div className="small muted">{user?.name} · {user?.email} · {user?.role === "admin" ? "Administrador" : "Trabajador"}</div>
          <Field label="Contraseña actual"><input className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
          <Field label="Nueva contraseña" hint="Mín. 10 caracteres con letras y números"><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <Field label="Repita la nueva contraseña"><input className="input" type="password" autoComplete="new-password" value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} /></Field>
          <ErrorBox error={err} />
          <Button variant="primary" loading={busy} onClick={change} disabled={!f.current || !f.password}>Cambiar contraseña</Button>
        </div>
      </Card>
      <Card title="Sesiones abiertas" icon={<ShieldCheck size={16} color="var(--lime)" />} pad={false} actions={<Button size="sm" icon={<LogOut size={14} />} onClick={logout}>Cerrar esta sesión</Button>}>
        <table className="table"><tbody>{sessions.data?.map((s) => (
          <tr key={s.id}>
            <td><div className="small">{s.user_agent?.slice(0, 60) || "Dispositivo"}</div><div className="tiny dim">{s.ip} · activa {ago(s.last_seen_at)}</div></td>
            <td className="right">{s.current ? <Badge tone="lime">Esta sesión</Badge> : <Button size="sm" variant="danger" onClick={async () => { await api.del(`/auth/sessions/${s.id}`); sessions.refetch(); }}>Cerrar</Button>}</td>
          </tr>
        ))}</tbody></table>
      </Card>
    </div>
  );
}

function SystemTab() {
  const sys = useQuery({ queryKey: ["system"], queryFn: () => api.get<any>("/settings/system") });
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api.get<any[]>("/users/audit?limit=200") });
  return (
    <div className="stack">
      <div className="grid g2">
        <Card title="Estado del sistema" icon={<Server size={16} color="var(--lime)" />}>
          {sys.data ? (
            <dl className="kv">
              <dt>Versión</dt><dd>{sys.data.version}</dd>
              <dt>Base de datos</dt><dd>{sys.data.database} · {sys.data.databaseSize}</dd>
              <dt>Entorno</dt><dd>{sys.data.production ? "Producción" : "Desarrollo"}</dd>
              <dt>URL pública</dt><dd>{sys.data.publicUrl}</dd>
              <dt>Asistente IA</dt><dd>{sys.data.ai ? <Badge tone="lime">Activo · {sys.data.aiModel}</Badge> : <Badge>No configurado</Badge>}</dd>
              <dt>Correo saliente</dt><dd>{sys.data.mail ? <Badge tone="lime">Configurado</Badge> : <Badge tone="amber">Sin SMTP: la recuperación de contraseña usa enlaces generados por un administrador</Badge>}</dd>
            </dl>
          ) : <Loading rows={3} />}
        </Card>
        <Card title="Copias de seguridad" icon={<Download size={16} color="var(--lime)" />}>
          <div className="stack">
            <p className="small muted">Descargue una exportación completa de los datos de negocio (JSON). No incluye contraseñas ni credenciales de integraciones.</p>
            <a className="btn btn-primary" href="/api/settings/backup"><Download size={16} />Descargar copia ahora</a>
            <p className="tiny dim">En producción, programe además copias diarias de PostgreSQL con <code>scripts/backup.sh</code> (pg_dump) tal como se describe en el README.</p>
          </div>
        </Card>
      </div>
      <Card title="Registro de actividad" icon={<UserCog size={16} color="var(--lime)" />} pad={false}>
        {audit.isLoading ? <Loading /> : (
          <div className="table-wrap" style={{ maxHeight: 480, overflowY: "auto" }}><table className="table">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Elemento</th><th>IP</th></tr></thead>
            <tbody>{audit.data?.map((a) => (
              <tr key={a.id}><td className="small nowrap">{dateTime(a.created_at)}</td><td className="small">{a.user_name ?? "—"}</td><td className="mono small">{a.action}</td><td className="small dim">{a.entity}{a.entity_id ? ` · ${String(a.entity_id).slice(0, 8)}` : ""}</td><td className="small dim">{a.ip}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
