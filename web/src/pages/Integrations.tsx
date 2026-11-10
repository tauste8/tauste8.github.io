import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, ExternalLink, FileSpreadsheet, KeyRound, Lock, Plug, Plus, ScrollText, Settings2, Sparkles, Trash2, Upload, XCircle, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, Badge, Button, Card, Confirm, ErrorBox, Field, Loading, Modal, PageHead, StatusBadge, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ago, dateTime, num } from "../lib/format";
import { useSuppliers } from "./Inventory";

const KIND_LABEL: Record<string, string> = {
  oem: "Catálogo OEM", iam: "Equivalencias IAM", offers_new: "Recambio nuevo (tarifa / stock)", offers_used: "Recambio usado (CAT / desguace)", vehicle: "Identificación de vehículos",
};

export function IntegrationsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const q = useQuery({ queryKey: ["integrations"], queryFn: () => api.get<any>("/integrations") });
  const [newSource, setNewSource] = useState(false);
  const [importFor, setImportFor] = useState<any | null>(null);
  const [configFor, setConfigFor] = useState<any | null>(null);
  const [logsFor, setLogsFor] = useState<any | null>(null);
  const [delFor, setDelFor] = useState<any | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  if (q.isLoading) return <Loading rows={6} />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  const conn = (k: string) => d.connectors.find((c: any) => c.key === k);
  const fileSources = d.sources.filter((s: any) => s.connector_key === "archivo");
  const manualSources = d.sources.filter((s: any) => s.connector_key === "manual");
  const apiSources = d.sources.filter((s: any) => conn(s.connector_key)?.mode === "api");
  const licSources = d.sources.filter((s: any) => conn(s.connector_key)?.mode === "licencia");

  async function test(s: any) {
    try {
      const r = await api.post<{ ok: boolean; message: string }>(`/integrations/sources/${s.id}/test`);
      r.ok ? toast.ok(r.message) : toast.err(new Error(r.message));
      qc.invalidateQueries({ queryKey: ["integrations"] });
    } catch (e) { toast.err(e); }
  }
  async function toggle(s: any) {
    try {
      await api.put(`/integrations/sources/${s.id}`, { enabled: !s.enabled });
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.ok(s.enabled ? "Fuente desactivada" : "Fuente activada");
    } catch (e) { toast.err(e); }
  }

  return (
    <>
      <PageHead title="Integraciones" subtitle="Fuentes de datos del buscador. Cada conector es independiente: añadir un proveedor no requiere modificar la aplicación."
        actions={isAdmin && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setNewSource(true)}>Nueva fuente de archivo</Button>} />
      {!isAdmin && <Alert tone="blue">Solo los administradores pueden configurar integraciones e importar archivos.</Alert>}

      <div className="stack" style={{ gap: 18 }}>
        <Card title="Tarifas, stock y catálogos por archivo (CSV / Excel)" icon={<FileSpreadsheet size={16} color="var(--lime)" />} pad={false}
          actions={<span className="small dim">Plantillas:{" "}{Object.keys(d.templates).map((k) => <a key={k} className="btn btn-sm btn-ghost" href={`/api/integrations/templates/${k}`}><Download size={13} />{KIND_LABEL[k]}</a>)}</span>}>
          {fileSources.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Fuente</th><th>Tipo de datos</th><th>Proveedor</th><th className="right">Registros</th><th>Última importación</th><th>Estado</th><th></th></tr></thead>
              <tbody>{fileSources.map((s: any) => (
                <tr key={s.id}>
                  <td className="strong">{s.name}{s.verified_source && <Badge tone="lime">Verificada</Badge>}{s.last_error && <div className="tiny" style={{ color: "var(--amber)" }}>{s.last_error}</div>}</td>
                  <td className="small">{s.kindLabel}</td>
                  <td className="small">{s.supplier_name ?? <span className="dim">—</span>}</td>
                  <td className="right">{num(s.records)}</td>
                  <td className="small">{ago(s.last_sync_at)}</td>
                  <td><StatusBadge status={!s.enabled ? "desactivado" : s.records ? "activo" : "sin_datos"} /></td>
                  <td className="right nowrap">
                    {isAdmin && <Button size="sm" variant="primary" icon={<Upload size={13} />} onClick={() => setImportFor(s)}>Importar</Button>}
                    <Button size="sm" variant="ghost" iconOnly icon={<ScrollText size={14} />} onClick={() => setLogsFor(s)} title="Registro" aria-label="Registro" />
                    {isAdmin && <Button size="sm" variant="ghost" iconOnly icon={<Zap size={14} />} onClick={() => test(s)} title="Probar" aria-label="Probar" />}
                    {isAdmin && <Button size="sm" variant="ghost" iconOnly icon={<Settings2 size={14} />} onClick={() => setConfigFor(s)} title="Configurar" aria-label="Configurar" />}
                    {isAdmin && <Button size="sm" variant="ghost" iconOnly icon={<Trash2 size={14} />} onClick={() => setDelFor(s)} title="Eliminar" aria-label="Eliminar" />}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : (
            <div className="card-body stack">
              <p className="muted">Aún no hay fuentes de archivo. Es la forma de conectar proveedores sin API: cree una fuente por cada tarifa, listado de stock CAT o tabla de equivalencias e importe el archivo que le envíe el proveedor.</p>
              {isAdmin && <div><Button variant="primary" icon={<Plus size={16} />} onClick={() => setNewSource(true)}>Crear la primera fuente</Button></div>}
            </div>
          )}
        </Card>

        <div className="grid g2">
          <Card title="Datos internos" icon={<CheckCircle2 size={16} color="var(--lime)" />}>
            <div className="stack" style={{ gap: 10 }}>
              <div className="row between"><span>Inventario propio</span><span className="row"><span className="small dim">{num(d.inventory.n)} piezas</span><Badge tone="lime" dot>Activo</Badge></span></div>
              {manualSources.map((s: any) => (
                <div key={s.id} className="row between"><span>{s.name}</span><span className="row"><span className="small dim">{num(s.records)} registros</span><Badge tone="lime" dot>Activo</Badge></span></div>
              ))}
              <p className="tiny dim">Siempre activos. Las referencias registradas desde el buscador se reutilizan en las siguientes búsquedas.</p>
            </div>
          </Card>
          <Card title="Asistente de IA (Claude)" icon={<Sparkles size={16} color="var(--lime)" />}>
            <div className="stack" style={{ gap: 10 }}>
              <div className="row between"><span>Estado</span>{d.ai.configured ? <Badge tone="lime" dot>Configurado</Badge> : <Badge dot>No configurado</Badge>}</div>
              <p className="small muted">Interpreta denominaciones de piezas que el diccionario no reconoce y lee referencias en fotografías. Nunca genera referencias, precios ni compatibilidades.</p>
              {!d.ai.configured && <p className="tiny dim">Para activarlo, defina la variable de entorno <code>ANTHROPIC_API_KEY</code> en el servidor y reinícielo. La clave nunca se guarda en el navegador.</p>}
            </div>
          </Card>
        </div>

        <Card title="Servicios por API" icon={<Plug size={16} color="var(--lime)" />} pad={false}>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Servicio</th><th>Datos</th><th>Estado</th><th>Último error</th><th></th></tr></thead>
            <tbody>{apiSources.map((s: any) => {
              const c = conn(s.connector_key);
              return (
                <tr key={s.id}>
                  <td><div className="strong">{c.name}</div><div className="tiny dim" style={{ maxWidth: 520 }}>{c.description}</div></td>
                  <td className="small">{c.kindLabels.join(", ")}</td>
                  <td><StatusBadge status={s.enabled ? (s.status === "error" ? "error" : "activo") : "desactivado"} /></td>
                  <td className="small" style={{ color: "var(--amber)" }}>{s.last_error ?? <span className="dim">—</span>}</td>
                  <td className="right nowrap">
                    {isAdmin && <Button size="sm" onClick={() => toggle(s)}>{s.enabled ? "Desactivar" : "Activar"}</Button>}
                    {isAdmin && <Button size="sm" variant="ghost" icon={<Zap size={14} />} onClick={() => test(s)}>Probar conexión</Button>}
                    <Button size="sm" variant="ghost" iconOnly icon={<ScrollText size={14} />} onClick={() => setLogsFor(s)} aria-label="Registro" />
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </Card>

        <Card title="Catálogos profesionales (requieren licencia o acuerdo)" icon={<Lock size={16} color="var(--amber)" />} pad={false}>
          <div className="card-body"><Alert tone="amber">Estas integraciones <b>no están conectadas</b>. AUTORECA no simula sus datos ni usa scraping. Para activarlas hace falta el contrato con el proveedor y su documentación técnica; mientras tanto puede importar sus exportaciones en CSV/Excel y configurar un enlace de consulta manual que aparecerá en el buscador.</Alert></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Catálogo</th><th>Datos</th><th>Qué se necesita</th><th>Credenciales</th><th>Consulta manual</th><th></th></tr></thead>
            <tbody>{licSources.map((s: any) => {
              const c = conn(s.connector_key);
              return (
                <tr key={s.id}>
                  <td><div className="strong">{c.name}</div><div className="tiny dim">{c.vendor}</div>{c.website && <a className="tiny" href={c.website} target="_blank" rel="noopener noreferrer">{c.website}</a>}</td>
                  <td className="small">{c.kindLabels.join(", ")}</td>
                  <td className="small" style={{ maxWidth: 380 }}><ul style={{ margin: 0, paddingLeft: 16 }}>{c.requirements.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul></td>
                  <td>{s.has_credentials ? <Badge tone="blue"><KeyRound size={12} />Guardadas</Badge> : <Badge>Sin credenciales</Badge>}<div className="tiny dim mt">API no implementada</div></td>
                  <td className="small">{s.config?.manual_url ? <a href={s.config.manual_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Abrir</a> : <span className="dim">—</span>}</td>
                  <td className="right nowrap">{isAdmin && <Button size="sm" icon={<Settings2 size={14} />} onClick={() => setConfigFor(s)}>Configurar</Button>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </Card>
      </div>

      {newSource && <NewSource onClose={() => setNewSource(false)} />}
      {importFor && <ImportModal source={importFor} templates={d.templates} onClose={() => setImportFor(null)} />}
      {configFor && <ConfigModal source={configFor} connector={conn(configFor.connector_key)} onClose={() => setConfigFor(null)} />}
      {logsFor && <LogsModal source={logsFor} onClose={() => setLogsFor(null)} />}
      {delFor && <Confirm title="Eliminar fuente" danger confirmLabel="Eliminar" message={`Se eliminará «${delFor.name}» y sus ${num(delFor.records)} registros importados.`} onClose={() => setDelFor(null)}
        onConfirm={async () => { await api.del(`/integrations/sources/${delFor.id}`); qc.invalidateQueries({ queryKey: ["integrations"] }); toast.ok("Fuente eliminada"); }} />}
    </>
  );
}

function NewSource({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const suppliers = useSuppliers();
  const [f, setF] = useState({ name: "", data_kind: "offers_new", supplier_id: "", verified_source: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/integrations/sources", f);
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.ok("Fuente creada. Ya puede importar su archivo.");
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title="Nueva fuente de archivo" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Crear fuente</Button></>}>
      <div className="stack">
        <Field label="Nombre"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Tarifa Distribuidor Norte · Stock CAT Sevilla…" /></Field>
        <Field label="Tipo de datos">
          <select className="select" value={f.data_kind} onChange={(e) => setF({ ...f, data_kind: e.target.value })}>
            {["offers_new", "offers_used", "iam", "oem"].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Proveedor" hint="Sus datos de contacto aparecerán en los resultados"><select className="select" value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })}><option value="">—</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <label className="check"><input type="checkbox" checked={f.verified_source} onChange={(e) => setF({ ...f, verified_source: e.target.checked })} />Fuente técnica verificada (catálogo oficial del fabricante). Permite confirmar compatibilidades.</label>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function ImportModal({ source, templates, onClose }: { source: any; templates: Record<string, { key: string; required?: boolean; help: string }[]>; onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState(source.data_kind.startsWith("offers") ? "reemplazar" : "anadir");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [result, setResult] = useState<{ total: number; ok: number; errors: { fila: number; error: string }[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const cols = templates[source.data_kind] ?? [];
  async function run() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      setResult(await api.post(`/integrations/sources/${source.id}/import`, fd));
      qc.invalidateQueries({ queryKey: ["integrations"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Importar · ${source.name}`} onClose={onClose} size="wide" footer={<><Button onClick={onClose}>Cerrar</Button><Button variant="primary" icon={<Upload size={16} />} loading={busy} disabled={!file} onClick={run}>Importar</Button></>}>
      <div className="stack">
        <div className="dropzone" onClick={() => input.current?.click()}>
          <input ref={input} type="file" accept=".csv,.xlsx,.txt" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
          <FileSpreadsheet size={26} color="var(--lime)" />
          <div className="strong mt">{file ? file.name : "Seleccione un archivo .csv o .xlsx"}</div>
          <div className="small">{file ? `${(file.size / 1024).toFixed(0)} KB` : "Primera fila con los nombres de columna"}</div>
        </div>
        <div className="row row-wrap">
          <label className="check"><input type="radio" name="mode" checked={mode === "anadir"} onChange={() => setMode("anadir")} />Añadir / actualizar</label>
          <label className="check"><input type="radio" name="mode" checked={mode === "reemplazar"} onChange={() => setMode("reemplazar")} />Reemplazar todos los datos de esta fuente</label>
        </div>
        {result && (
          <Alert tone={result.errors.length ? "amber" : "lime"}>
            <b>{num(result.ok)} de {num(result.total)} filas importadas.</b>
            {result.errors.length > 0 && (
              <div className="mt" style={{ maxHeight: 180, overflowY: "auto" }}>
                {result.errors.slice(0, 100).map((e, i) => <div key={i} className="small">Fila {e.fila}: {e.error}</div>)}
              </div>
            )}
          </Alert>
        )}
        <ErrorBox error={err} />
        <details>
          <summary className="small strong" style={{ cursor: "pointer" }}>Columnas admitidas para «{KIND_LABEL[source.data_kind]}»</summary>
          <table className="table mt"><tbody>{cols.map((c) => (
            <tr key={c.key}><td className="mono small">{c.key}</td><td className="small">{c.help}</td><td>{c.required && <Badge tone="amber">Obligatoria</Badge>}</td></tr>
          ))}</tbody></table>
          <a className="btn btn-sm mt" href={`/api/integrations/templates/${source.data_kind}`}><Download size={13} />Descargar plantilla</a>
        </details>
      </div>
    </Modal>
  );
}

function ConfigModal({ source, connector, onClose }: { source: any; connector: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const suppliers = useSuppliers();
  const [name, setName] = useState(source.name);
  const [supplierId, setSupplierId] = useState(source.supplier_id ?? "");
  const [verified, setVerified] = useState(source.verified_source);
  const [manualUrl, setManualUrl] = useState(source.config?.manual_url ?? "");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { name, supplier_id: supplierId, verified_source: verified };
      if (connector.allowsManualUrl) body.manual_url = manualUrl;
      if (Object.keys(creds).length) body.credentials = creds;
      await api.put(`/integrations/sources/${source.id}`, body);
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast.ok("Configuración guardada");
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Configurar · ${connector.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Guardar</Button></>}>
      <div className="stack">
        {connector.mode === "licencia" && <Alert tone="amber">La conexión por API de {connector.name} no está implementada. Las credenciales se guardan cifradas (AES-256-GCM) para cuando se desarrolle el conector con la documentación oficial.</Alert>}
        {source.connector_key === "archivo" && <Field label="Nombre"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>}
        {source.connector_key === "archivo" && (
          <Field label="Proveedor"><select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">—</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        )}
        {source.connector_key === "archivo" && <label className="check"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />Fuente técnica verificada</label>}
        {connector.allowsManualUrl && <Field label="URL de consulta manual" hint="Se mostrará como botón en el buscador cuando no haya resultados (https://…)"><input className="input" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="https://" /></Field>}
        {connector.credentialFields.map((f: any) => (
          <Field key={f.key} label={f.label} hint={source.has_credentials ? "Deje en blanco para conservar el valor guardado" : undefined}>
            <input className="input" type={f.secret ? "password" : "text"} autoComplete="off" value={creds[f.key] ?? ""} onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })} />
          </Field>
        ))}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function LogsModal({ source, onClose }: { source: any; onClose: () => void }) {
  const q = useQuery({ queryKey: ["source-logs", source.id], queryFn: () => api.get<any>(`/integrations/sources/${source.id}/logs`) });
  return (
    <Modal title={`Registro · ${source.name}`} onClose={onClose} size="wide">
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : (
        <div className="stack">
          {q.data.imports.length > 0 && (
            <>
              <div className="label">Importaciones</div>
              <table className="table"><thead><tr><th>Fecha</th><th>Archivo</th><th>Modo</th><th className="right">Correctas</th><th className="right">Errores</th><th>Usuario</th></tr></thead>
                <tbody>{q.data.imports.map((i: any) => (
                  <tr key={i.id}><td className="small">{dateTime(i.created_at)}</td><td>{i.filename}</td><td className="small">{i.mode}</td><td className="right">{i.rows_ok}/{i.rows_total}</td><td className="right">{i.rows_error ? <Badge tone="amber">{i.rows_error}</Badge> : 0}</td><td className="small">{i.user_name}</td></tr>
                ))}</tbody></table>
            </>
          )}
          <div className="label">Eventos</div>
          {q.data.logs.length ? (
            <table className="table"><tbody>{q.data.logs.map((l: any) => (
              <tr key={l.id}><td className="small nowrap">{dateTime(l.created_at)}</td><td>{l.level === "error" ? <XCircle size={14} color="var(--red)" /> : l.level === "warn" ? <XCircle size={14} color="var(--amber)" /> : <CheckCircle2 size={14} color="var(--lime)" />}</td><td className="small">{l.message}</td></tr>
            ))}</tbody></table>
          ) : <span className="small dim">Sin eventos registrados.</span>}
        </div>
      )}
    </Modal>
  );
}
