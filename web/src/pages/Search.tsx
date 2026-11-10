import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, BadgeCheck, Camera, Car, CheckCircle2, ChevronDown, ChevronUp, Circle, Clock, Database, ExternalLink, FilePlus2, GitCompare,
  Hash, ImageOff, Loader2, Mail, MapPin, Package, Phone, Plus, Recycle, Save, ScanSearch, Search as SearchIcon, ShieldCheck, Sparkles, Truck, Wrench, XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Badge, Button, Card, CompatBadge, Empty, ErrorBox, Field, Modal, useToast } from "../components/ui";
import { api } from "../lib/api";
import { ago, dateTime, eur, ms } from "../lib/format";
import type { CompatStatus, PartType, ResultItem, SearchResponse, Step, Vehicle } from "../lib/types";

const QUICK_PARTS = ["Alternador", "Motor de arranque", "Turbo", "Caja de cambios", "Compresor de aire acondicionado", "Retrovisor izquierdo", "Faro delantero derecho", "Inyector", "EGR", "Bomba de agua"];

function detectKind(v: string): "vin" | "matricula" | null {
  const q = v.toUpperCase().replace(/[\s\-.]/g, "");
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(q)) return "vin";
  if (/^[0-9]{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/.test(q) || /^[A-Z]{1,2}[0-9]{4}[A-Z]{1,2}$/.test(q) || /^[A-Z]{1,2}[0-9]{1,6}$/.test(q)) return "matricula";
  return null;
}

export function usePartTypes() {
  return useQuery({ queryKey: ["parts"], queryFn: () => api.get<PartType[]>("/search/parts"), staleTime: Infinity });
}

type Mode = "vehiculo" | "referencia" | "foto";

interface Filters {
  compat: Record<CompatStatus, boolean>;
  condition: "todos" | "nuevo" | "usado";
  inStock: boolean;
  withPrice: boolean;
  priceMin: string;
  priceMax: string;
  brands: string[];
  suppliers: string[];
  location: string;
  sort: "relevancia" | "precio_asc" | "precio_desc" | "disponibilidad";
}
const defaultFilters: Filters = {
  compat: { confirmada: true, pendiente: true, no_compatible: false }, condition: "todos", inStock: false, withPrice: false,
  priceMin: "", priceMax: "", brands: [], suppliers: [], location: "", sort: "relevancia",
};

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const parts = usePartTypes();
  const caps = useQuery({ queryKey: ["caps"], queryFn: () => api.get<{ ai: boolean }>("/search/capabilities") });
  const customers = useQuery({ queryKey: ["customers", ""], queryFn: () => api.get<{ id: string; name: string }[]>("/customers") });

  const [mode, setMode] = useState<Mode>("vehiculo");
  const [vehicleQ, setVehicleQ] = useState("");
  const [partQ, setPartQ] = useState("");
  const [refQ, setRefQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [compare, setCompare] = useState<ResultItem[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [quoteItem, setQuoteItem] = useState<ResultItem | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const lastBody = useRef<Record<string, unknown>>({});
  const resultsRef = useRef<HTMLDivElement>(null);

  // Cargar desde historial o prefijar desde otra pantalla
  const hParam = params.get("h");
  useEffect(() => {
    if (hParam) {
      if (res?.id === hParam) return;
      setBusy(true);
      api.get<SearchResponse>(`/search/history/${hParam}`).then((r) => {
        setRes(r);
        setVehicleQ(r.vehicle?.plate ?? r.vehicle?.vin ?? "");
        setPartQ(r.part?.input ?? "");
        setVehicleId(r.vehicle?.id ?? null);
      }).catch(setErr).finally(() => setBusy(false));
      return;
    }
    const vid = params.get("vehicleId");
    const v = params.get("v");
    if (vid) setVehicleId(vid);
    if (v) setVehicleQ(v);
    const r = params.get("ref");
    if (r) { setMode("referencia"); setRefQ(r); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hParam]);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const i = setInterval(() => setElapsed(Date.now() - t0), 100);
    return () => clearInterval(i);
  }, [busy]);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    lastBody.current = body;
    try {
      const r = await api.post<SearchResponse>("/search", { ...body, customerId: customerId || undefined });
      setRes(r);
      setVehicleId(r.vehicle?.id ?? null);
      setFilters((f) => ({ ...defaultFilters, sort: f.sort }));
      setCompare([]);
      if (r.id) setParams({ h: r.id }, { replace: true });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (mode === "referencia") {
      if (!refQ.trim()) return setErr(new Error("Escriba una referencia OEM o de fabricante"));
      run({ ref: refQ.trim(), vehicle: vehicleQ.trim() || undefined, vehicleId: vehicleId && !vehicleQ.trim() ? vehicleId : undefined });
    } else {
      if (!vehicleQ.trim() && !vehicleId) return setErr(new Error("Escriba la matrícula o el bastidor"));
      if (!partQ.trim()) return setErr(new Error("Escriba la pieza que necesita"));
      run({ vehicle: vehicleQ.trim() || undefined, vehicleId: vehicleId && !vehicleQ.trim() ? vehicleId : undefined, part: partQ.trim() });
    }
  }

  const rerun = (extra: Record<string, unknown>) => {
    const base = { ...lastBody.current };
    if (res?.vehicle?.id) { delete base.vehicle; base.vehicleId = res.vehicle.id; }
    run({ ...base, ...extra });
  };

  const kind = detectKind(vehicleQ);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="search-hero">
        <div className="row between row-wrap" style={{ marginBottom: 16 }}>
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}><ScanSearch size={24} color="var(--lime)" />Buscador inteligente</h1>
            <p className="muted small" style={{ marginTop: 4 }}>Matrícula o bastidor + pieza. AUTORECA identifica el vehículo, localiza la referencia OEM, sus equivalencias y el recambio usado disponible.</p>
          </div>
          <div className="mode-switch" role="tablist" aria-label="Tipo de búsqueda">
            <button className={mode === "vehiculo" ? "on" : ""} onClick={() => setMode("vehiculo")}><Car size={14} />Vehículo + pieza</button>
            <button className={mode === "referencia" ? "on" : ""} onClick={() => setMode("referencia")}><Hash size={14} />Referencia</button>
            <button className={mode === "foto" ? "on" : ""} onClick={() => setMode("foto")}><Camera size={14} />Fotografía</button>
          </div>
        </div>

        {mode === "foto" ? (
          <PhotoSearch aiAvailable={!!caps.data?.ai} onSearchRef={(r) => { setMode("referencia"); setRefQ(r); run({ ref: r, vehicle: vehicleQ.trim() || undefined }); }}
            onSearchPart={(name) => { setMode("vehiculo"); setPartQ(name); }} />
        ) : (
          <form onSubmit={submit} className="search-form">
            <Field label={mode === "referencia" ? "Matrícula o bastidor (opcional)" : "Matrícula o bastidor"}>
              <div className="search-input-wrap">
                <Car size={20} />
                <input className="input input-lg mono" style={{ textTransform: "uppercase", letterSpacing: "0.04em" }} placeholder="1234 BCD  ·  WVWZZZ1KZ6W000001"
                  value={vehicleQ} onChange={(e) => { setVehicleQ(e.target.value); setVehicleId(null); }} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-label="Matrícula o bastidor" />
                {vehicleQ && <span className="input-kind">{kind === "vin" ? <Badge tone="lime">VIN</Badge> : kind === "matricula" ? <Badge tone="blue">Matrícula</Badge> : <Badge tone="red">Formato no reconocido</Badge>}</span>}
                {!vehicleQ && vehicleId && <span className="input-kind"><Badge tone="lime">Vehículo seleccionado</Badge></span>}
              </div>
            </Field>
            {mode === "vehiculo" ? (
              <Field label="Pieza que necesita">
                <div className="search-input-wrap">
                  <Wrench size={20} />
                  <input className="input input-lg" list="part-list" placeholder="Alternador, retrovisor izquierdo, EGR…" value={partQ} onChange={(e) => setPartQ(e.target.value)} autoComplete="off" aria-label="Pieza" />
                  <datalist id="part-list">{parts.data?.map((p) => <option key={p.code} value={p.name} />)}</datalist>
                </div>
              </Field>
            ) : (
              <Field label="Referencia OEM o de fabricante">
                <div className="search-input-wrap">
                  <Hash size={20} />
                  <input className="input input-lg mono" placeholder="Ej.: 06F903023F · Bosch 0 124 525 093" value={refQ} onChange={(e) => setRefQ(e.target.value)} autoComplete="off" spellCheck={false} aria-label="Referencia" />
                </div>
              </Field>
            )}
            <Button type="submit" variant="primary" size="lg" loading={busy} icon={<SearchIcon size={18} />}>BUSCAR RECAMBIO</Button>
          </form>
        )}

        {mode === "vehiculo" && (
          <div className="row row-wrap" style={{ marginTop: 14, justifyContent: "space-between" }}>
            <div className="chips">
              {QUICK_PARTS.map((p) => <button key={p} type="button" className={`chip ${partQ === p ? "on" : ""}`} onClick={() => setPartQ(p)}>{p}</button>)}
            </div>
          </div>
        )}
        {mode !== "foto" && (
          <div className="row row-wrap" style={{ marginTop: 12 }}>
            <span className="small dim">Cliente (opcional):</span>
            <select className="select" style={{ width: 260, height: 32, fontSize: 13 }} value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Cliente">
              <option value="">Sin cliente</option>
              {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <ErrorBox error={err} />

      {busy && <RunningSteps elapsed={elapsed} />}

      {res && !busy && (
        <div ref={resultsRef} className="stack" style={{ gap: 16 }}>
          {res.fromHistory && <Alert tone="blue">Resultado guardado de una búsqueda del {dateTime(res.createdAt)}. Los precios y existencias pueden haber cambiado: <button className="btn btn-sm" onClick={() => rerun({})}>Repetir búsqueda</button></Alert>}
          <StepsBar steps={res.steps} durationMs={res.durationMs} />
          {res.vehicle && <VehicleStrip v={res.vehicle} onUpdated={(v) => setRes({ ...res, vehicle: v })} />}
          {res.clarification && (
            <Clarify res={res} onApply={(vehicleData) => rerun({ vehicleData })} onCreate={(vehicleData) => run({ ...lastBody.current, vehicleData })} />
          )}
          {res.part && <PartPanel res={res} parts={parts.data ?? []} onPick={(extra) => rerun({ part: undefined, ...extra })} />}
          {res.status === "requiere_pieza" && !res.part?.code && (
            <Card><PartPicker parts={parts.data ?? []} onPick={(code) => rerun({ partCode: code })} /></Card>
          )}
          {(res.status === "completado" || res.status === "sin_resultados") && (
            <Results res={res} filters={filters} setFilters={setFilters} compare={compare}
              onToggleCompare={(i) => setCompare((c) => c.some((x) => x.id === i.id) ? c.filter((x) => x.id !== i.id) : c.length >= 4 ? (toast.err(new Error("Máximo 4 referencias en el comparador")), c) : [...c, i])}
              onQuote={setQuoteItem} onRegister={() => setRegisterOpen(true)} />
          )}
        </div>
      )}

      {!res && !busy && <SearchIntro />}

      {compare.length > 0 && (
        <div style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 50 }}>
          <div className="card row" style={{ padding: "8px 10px", boxShadow: "var(--shadow)" }}>
            <GitCompare size={16} color="var(--lime)" />
            <span className="small">{compare.length} en el comparador</span>
            <Button size="sm" variant="primary" disabled={compare.length < 2} onClick={() => setShowCompare(true)}>Comparar</Button>
            <Button size="sm" variant="ghost" onClick={() => setCompare([])}>Vaciar</Button>
          </div>
        </div>
      )}
      {showCompare && <CompareModal items={compare} parts={parts.data ?? []} onClose={() => setShowCompare(false)} />}
      {quoteItem && <AddToQuote item={quoteItem} vehicleId={res?.vehicle?.id ?? null} customerId={customerId || null} onClose={() => setQuoteItem(null)} />}
      {registerOpen && res?.vehicle && res.part?.code && (
        <RegisterOem vehicle={res.vehicle} partCode={res.part.code} partName={res.part.name ?? ""} side={res.part.side} axle={res.part.axle}
          onClose={() => setRegisterOpen(false)} onDone={() => { setRegisterOpen(false); rerun({}); }} />
      )}
    </div>
  );
}

function SearchIntro() {
  const recent = useQuery({ queryKey: ["history", "me-recent"], queryFn: () => api.get<any[]>("/history?user=me") });
  const nav = useNavigate();
  return (
    <div className="grid g2">
      <Card title="Cómo funciona" icon={<Sparkles size={16} color="var(--lime)" />}>
        <ol className="stack" style={{ margin: 0, paddingLeft: 18, gap: 8 }}>
          <li><b>Vehículo.</b> Se busca la ficha guardada; si es un VIN se decodifica y, si falta algún dato, se pide solo lo imprescindible.</li>
          <li><b>Pieza.</b> Se interpreta la denominación (sinónimos, faltas de ortografía, lado y eje).</li>
          <li><b>OEM.</b> Se localiza la referencia original en los catálogos cargados y sus sustituciones.</li>
          <li><b>IAM.</b> Equivalencias de fabricantes y precios de los proveedores conectados.</li>
          <li><b>Usado CAT.</b> Piezas usadas por referencia OEM o por vehículo donante.</li>
          <li><b>Validación.</b> Cada resultado indica su compatibilidad, la fuente y lo que falta por verificar.</li>
        </ol>
      </Card>
      <Card title="Mis últimas búsquedas" icon={<Clock size={16} color="var(--lime)" />} pad={false}>
        {recent.data?.length ? (
          <div className="table-wrap">
            <table className="table"><tbody>
              {recent.data.slice(0, 7).map((s) => (
                <tr key={s.id} className="clickable" onClick={() => nav(`/buscador?h=${s.id}`)}>
                  <td className="mono">{s.plate ?? s.vin ?? s.query_vehicle ?? "—"}</td>
                  <td>{s.part_name ?? s.query_part ?? s.query_ref}</td>
                  <td className="right dim small">{ago(s.created_at)}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        ) : <Empty icon={<SearchIcon size={22} />} title="Aún no hay búsquedas">Su historial aparecerá aquí.</Empty>}
      </Card>
    </div>
  );
}

const RUN_STEPS = ["Identificando vehículo", "Interpretando pieza", "Buscando referencias OEM", "Buscando equivalencias IAM", "Buscando usados CAT", "Validando compatibilidad"];
function RunningSteps({ elapsed }: { elapsed: number }) {
  const idx = Math.min(RUN_STEPS.length - 1, Math.floor(elapsed / 350));
  return (
    <div className="steps">
      {RUN_STEPS.map((s, i) => (
        <div key={s} className={`step ${i < idx ? "ok" : i === idx ? "running" : ""}`}>
          <div className="step-top">{i < idx ? <CheckCircle2 size={13} /> : i === idx ? <Loader2 size={13} className="spin" style={{ animation: "spin 1s linear infinite" }} /> : <Circle size={13} />}Paso {i + 1}</div>
          <div className="step-label">{s}</div>
        </div>
      ))}
    </div>
  );
}

function StepIcon({ s }: { s: Step["status"] }) {
  if (s === "ok") return <CheckCircle2 size={13} />;
  if (s === "error" || s === "sin_resultados") return <XCircle size={13} />;
  if (s === "omitido") return <Circle size={13} />;
  return <AlertTriangle size={13} />;
}

function StepsBar({ steps, durationMs }: { steps: Step[]; durationMs: number }) {
  const [open, setOpen] = useState<Step | null>(null);
  const label: Record<string, string> = { ok: "Correcto", parcial: "Parcial", requiere_accion: "Requiere acción", sin_resultados: "Sin resultados", omitido: "Omitido", error: "Error" };
  return (
    <>
      <div className="row between"><span className="small dim">Proceso automático · {ms(durationMs)} · pulse un paso para ver las fuentes consultadas</span></div>
      <div className="steps">
        {steps.map((s, i) => (
          <button key={s.key} className={`step ${s.status}`} onClick={() => setOpen(s)}>
            <div className="step-top"><StepIcon s={s.status} />Paso {i + 1} · {label[s.status]}</div>
            <div className="step-label">{s.label}</div>
            <div className="step-detail" title={s.detail}>{s.detail || "—"}</div>
          </button>
        ))}
      </div>
      {open && (
        <Modal title={open.label} onClose={() => setOpen(null)}>
          <div className="stack">
            <p>{open.detail}</p>
            {open.sources.length > 0 && (
              <table className="table">
                <thead><tr><th>Fuente</th><th>Estado</th><th className="right">Coincidencias</th></tr></thead>
                <tbody>
                  {open.sources.map((src, i) => (
                    <tr key={i}>
                      <td>{src.name}{src.detail && <div className="tiny dim">{src.detail}</div>}</td>
                      <td>
                        {src.status === "consultado" ? <Badge tone="lime">Consultada</Badge> : src.status === "no_conectado" ? <Badge>No conectada</Badge>
                          : src.status === "desactivado" ? <Badge>Desactivada</Badge> : src.status === "error" ? <Badge tone="red">Error</Badge> : <Badge tone="amber">Sin datos</Badge>}
                      </td>
                      <td className="right">{src.matches ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="small dim">Las fuentes «No conectada» requieren licencia o credenciales. Puede configurarlas en <Link to="/integraciones">Integraciones</Link>.</p>
          </div>
        </Modal>
      )}
    </>
  );
}

function VehicleStrip({ v, onUpdated }: { v: Vehicle; onUpdated: (v: Vehicle) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const specs: [string, string | number | null][] = [
    ["Marca", v.make], ["Modelo", v.model], ["Generación", v.generation], ["Año", v.year], ["Motor", v.engine_code],
    ["Combustible", v.fuel], ["Potencia", v.power_kw ? `${v.power_kw} kW · ${Math.round(v.power_kw * 1.36)} CV` : null], ["Cilindrada", v.displacement_cc ? `${v.displacement_cc} cc` : null],
  ];
  async function confirm() {
    setBusy(true);
    try {
      const r = await api.put<Vehicle>(`/vehicles/${v.id}`, { ...v, confirm: true });
      onUpdated(r);
      toast.ok("Ficha del vehículo confirmada");
    } catch (e) { toast.err(e); } finally { setBusy(false); }
  }
  return (
    <div className="card vehicle-strip">
      <div className="row">
        {v.plate && <span className="plate">{v.plate}</span>}
        {v.vin && <span className="mono small muted">{v.vin}</span>}
      </div>
      {specs.map(([k, val]) => (
        <div key={k} className="spec"><small>{k}</small><b style={{ color: val ? undefined : "var(--amber)" }}>{val ?? "Falta"}</b></div>
      ))}
      <div className="grow" />
      <div className="row row-wrap">
        {v.identification_level === "confirmada" ? <Badge tone="lime"><ShieldCheck size={12} />Ficha confirmada</Badge> : (
          <>
            <Badge tone="amber">Identificación parcial</Badge>
            {v.make && v.model && v.engine_code && v.year && <Button size="sm" loading={busy} icon={<BadgeCheck size={14} />} onClick={confirm} title="Confirme que ha comprobado los datos con la documentación del vehículo">Confirmar datos</Button>}
          </>
        )}
        <Link className="btn btn-sm btn-ghost" to={`/vehiculos/${v.id}`}>Ficha</Link>
      </div>
      {v.identification_source && <div className="tiny dim" style={{ width: "100%" }}>Fuente: {v.identification_source}</div>}
    </div>
  );
}

function Clarify({ res, onApply, onCreate }: { res: SearchResponse; onApply: (d: Record<string, unknown>) => void; onCreate: (d: Record<string, unknown>) => void }) {
  const c = res.clarification!;
  const v = res.vehicle;
  const [f, setF] = useState({ make: v?.make ?? "", model: v?.model ?? "", year: v?.year ? String(v.year) : "", engine_code: v?.engine_code ?? "", fuel: v?.fuel ?? "", power_kw: v?.power_kw ? String(v.power_kw) : "", vin: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const data = () => Object.fromEntries(Object.entries(f).filter(([, val]) => val !== "").map(([k, val]) => [k, ["year", "power_kw"].includes(k) ? Number(val) : val]));
  return (
    <Card title={c.canCreateFromPlate ? `Matrícula ${c.canCreateFromPlate} sin identificar` : "Se necesita una aclaración"} icon={<AlertTriangle size={16} color="var(--amber)" />}>
      <div className="stack">
        <p className="muted">{c.message}</p>
        {c.candidates.length > 0 && (
          <div>
            <div className="label mb">Versiones posibles según los catálogos cargados</div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Modelo</th><th>Generación</th><th>Años</th><th>Códigos de motor</th><th>Combustible</th><th>Potencia</th><th></th></tr></thead>
                <tbody>
                  {c.candidates.map((x, i) => (
                    <tr key={i}>
                      <td>{x.model ?? "—"}</td><td>{x.generation ?? "—"}</td><td>{x.year_from ?? "…"}–{x.year_to ?? "…"}</td>
                      <td className="mono">{x.engine_codes.join(", ")}</td><td>{x.fuel ?? "—"}</td>
                      <td>{x.power_kw_from ? `${x.power_kw_from}${x.power_kw_to && x.power_kw_to !== x.power_kw_from ? `–${x.power_kw_to}` : ""} kW` : "—"}</td>
                      <td className="right">
                        {x.engine_codes.map((code) => (
                          <Button key={code} size="sm" onClick={() => onApply({ model: x.model ?? undefined, generation: x.generation ?? undefined, engine_code: code, fuel: x.fuel ?? undefined })}>{code}</Button>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny dim mt">Seleccionar una versión no la confirma: compruebe el código de motor en la documentación o en el propio motor.</p>
          </div>
        )}
        <div className="grid g4">
          {c.canCreateFromPlate && <Field label="Bastidor (VIN)" className="span2"><input className="input mono" value={f.vin} onChange={set("vin")} maxLength={17} placeholder="17 caracteres" /></Field>}
          <Field label="Marca"><input className="input" value={f.make} onChange={set("make")} /></Field>
          <Field label="Modelo"><input className="input" value={f.model} onChange={set("model")} /></Field>
          <Field label="Año"><input className="input" inputMode="numeric" value={f.year} onChange={set("year")} /></Field>
          <Field label="Código de motor"><input className="input mono" value={f.engine_code} onChange={set("engine_code")} /></Field>
          <Field label="Combustible">
            <select className="select" value={f.fuel} onChange={set("fuel")}>
              <option value="">—</option><option>Diésel</option><option>Gasolina</option><option>Híbrido</option><option>Eléctrico</option><option>GLP</option><option>GNC</option>
            </select>
          </Field>
          <Field label="Potencia (kW)"><input className="input" inputMode="numeric" value={f.power_kw} onChange={set("power_kw")} /></Field>
        </div>
        <div className="row">
          <Button variant="primary" icon={<ArrowRight size={16} />} onClick={() => (c.canCreateFromPlate ? onCreate(data()) : onApply(data()))}>
            {c.canCreateFromPlate ? "Guardar vehículo y buscar" : "Completar datos y repetir búsqueda"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function PartPanel({ res, parts, onPick }: { res: SearchResponse; parts: PartType[]; onPick: (x: Record<string, unknown>) => void }) {
  const p = res.part!;
  const [changing, setChanging] = useState(false);
  const def = parts.find((x) => x.code === p.code);
  return (
    <div className="card card-pad">
      <div className="row row-wrap between">
        <div className="row row-wrap">
          <Wrench size={18} color="var(--lime)" />
          <div>
            <div className="strong">{p.name ?? `«${p.input}» no reconocido`}{p.axle || p.side ? <span className="muted"> · {[p.axle, p.side].filter(Boolean).join(" ")}</span> : null}</div>
            <div className="tiny dim">{p.source}{p.code && ` · certeza ${Math.round(p.confidence * 100)} %`}{p.correctedFrom && ` · corregido de «${p.correctedFrom}»`}</div>
          </div>
        </div>
        <div className="row row-wrap">
          {def?.axle && !p.axle && (["delantero", "trasero"] as const).map((a) => <Button key={a} size="sm" onClick={() => onPick({ partCode: p.code, axle: a, side: p.side ?? undefined })}>{a[0].toUpperCase() + a.slice(1)}</Button>)}
          {def?.sided && !p.side && (["izquierdo", "derecho"] as const).map((s) => <Button key={s} size="sm" onClick={() => onPick({ partCode: p.code, side: s, axle: p.axle ?? undefined })}>{s[0].toUpperCase() + s.slice(1)}</Button>)}
          <Button size="sm" variant="ghost" onClick={() => setChanging(!changing)}>{changing ? "Cerrar" : "Cambiar pieza"}</Button>
        </div>
      </div>
      {(p.notes.length > 0 || p.missing.length > 0 || p.alternatives.length > 0) && (
        <div className="row row-wrap mt small">
          {p.missing.length > 0 && <Badge tone="amber">Falta: {p.missing.join(", ")}</Badge>}
          {p.notes.map((n, i) => <span key={i} className="muted">{n}</span>)}
          {p.alternatives.map((a) => <button key={a.code} className="chip" onClick={() => onPick({ partCode: a.code })}>¿{a.name}?</button>)}
        </div>
      )}
      {changing && <div className="mt"><PartPicker parts={parts} onPick={(code) => onPick({ partCode: code })} /></div>}
    </div>
  );
}

function PartPicker({ parts, onPick }: { parts: PartType[]; onPick: (code: string) => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const m = new Map<string, PartType[]>();
    for (const p of parts.filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()))) m.set(p.category, [...(m.get(p.category) ?? []), p]);
    return [...m.entries()];
  }, [parts, q]);
  return (
    <div className="stack">
      <input className="input" placeholder="Filtrar tipo de pieza…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrar tipo de pieza" />
      <div className="grid g3" style={{ maxHeight: 300, overflowY: "auto" }}>
        {groups.map(([cat, list]) => (
          <div key={cat}>
            <div className="tiny dim strong" style={{ textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>{cat}</div>
            <div className="chips">{list.map((p) => <button key={p.code} className="chip" onClick={() => onPick(p.code)}>{p.name}</button>)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────── Resultados ───────────────
function Results({ res, filters, setFilters, compare, onToggleCompare, onQuote, onRegister }: {
  res: SearchResponse; filters: Filters; setFilters: (f: Filters) => void; compare: ResultItem[];
  onToggleCompare: (i: ResultItem) => void; onQuote: (i: ResultItem) => void; onRegister: () => void;
}) {
  const all = [...res.results.oem, ...res.results.iam, ...res.results.cat];
  const brands = [...new Set(all.map((i) => i.brand).filter(Boolean) as string[])].sort();
  const suppliers = [...new Set(all.map((i) => i.supplier?.name ?? (i.kind === "inventario" ? "Inventario propio" : null)).filter(Boolean) as string[])].sort();
  const counts = { confirmada: 0, pendiente: 0, no_compatible: 0 } as Record<CompatStatus, number>;
  all.forEach((i) => counts[i.compat.status]++);

  const apply = (list: ResultItem[]) => {
    let out = list.filter((i) => filters.compat[i.compat.status]);
    if (filters.condition !== "todos") out = out.filter((i) => i.condition === filters.condition);
    if (filters.inStock) out = out.filter((i) => (i.stock ?? 0) > 0);
    if (filters.withPrice) out = out.filter((i) => i.price != null);
    if (filters.priceMin) out = out.filter((i) => i.price != null && i.price >= Number(filters.priceMin));
    if (filters.priceMax) out = out.filter((i) => i.price != null && i.price <= Number(filters.priceMax));
    if (filters.brands.length) out = out.filter((i) => i.brand && filters.brands.includes(i.brand));
    if (filters.suppliers.length) out = out.filter((i) => filters.suppliers.includes(i.supplier?.name ?? (i.kind === "inventario" ? "Inventario propio" : "")));
    if (filters.location) out = out.filter((i) => (i.location ?? "").toLowerCase().includes(filters.location.toLowerCase()));
    const s = [...out];
    if (filters.sort === "precio_asc") s.sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12));
    else if (filters.sort === "precio_desc") s.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    else if (filters.sort === "disponibilidad") s.sort((a, b) => (b.stock ?? -1) - (a.stock ?? -1));
    return s;
  };
  const cols = [
    { key: "oem" as const, letter: "A", title: "ORIGINAL OEM", icon: <ShieldCheck size={15} />, list: apply(res.results.oem), total: res.results.oem.length },
    { key: "iam" as const, letter: "B", title: "EQUIVALENTES IAM", icon: <Package size={15} />, list: apply(res.results.iam), total: res.results.iam.length },
    { key: "cat" as const, letter: "C", title: "USADOS CAT", icon: <Recycle size={15} />, list: apply(res.results.cat), total: res.results.cat.length },
  ];
  const toggleList = (k: "brands" | "suppliers", v: string) => setFilters({ ...filters, [k]: filters[k].includes(v) ? filters[k].filter((x) => x !== v) : [...filters[k], v] });

  return (
    <div className="results-layout">
      <aside className="card filters" aria-label="Filtros">
        <div className="filters-inner">
          <div>
            <h4>Ordenar por</h4>
            <select className="select" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as Filters["sort"] })} aria-label="Ordenar">
              <option value="relevancia">Relevancia</option><option value="precio_asc">Precio: menor a mayor</option>
              <option value="precio_desc">Precio: mayor a menor</option><option value="disponibilidad">Disponibilidad</option>
            </select>
          </div>
          <div>
            <h4>Compatibilidad</h4>
            <div className="stack" style={{ gap: 6 }}>
              {(["confirmada", "pendiente", "no_compatible"] as CompatStatus[]).map((k) => (
                <label key={k} className="check"><input type="checkbox" checked={filters.compat[k]} onChange={(e) => setFilters({ ...filters, compat: { ...filters.compat, [k]: e.target.checked } })} />
                  <CompatBadge status={k} short /> <span className="dim tiny">{counts[k]}</span></label>
              ))}
            </div>
          </div>
          <div>
            <h4>Estado</h4>
            <select className="select" value={filters.condition} onChange={(e) => setFilters({ ...filters, condition: e.target.value as Filters["condition"] })} aria-label="Nuevo o usado">
              <option value="todos">Nuevo y usado</option><option value="nuevo">Solo nuevo</option><option value="usado">Solo usado</option>
            </select>
          </div>
          <div>
            <h4>Disponibilidad y precio</h4>
            <div className="stack" style={{ gap: 6 }}>
              <label className="check"><input type="checkbox" checked={filters.inStock} onChange={(e) => setFilters({ ...filters, inStock: e.target.checked })} />Solo con stock</label>
              <label className="check"><input type="checkbox" checked={filters.withPrice} onChange={(e) => setFilters({ ...filters, withPrice: e.target.checked })} />Solo con precio</label>
              <div className="row">
                <input className="input" placeholder="Mín €" inputMode="decimal" value={filters.priceMin} onChange={(e) => setFilters({ ...filters, priceMin: e.target.value })} aria-label="Precio mínimo" />
                <input className="input" placeholder="Máx €" inputMode="decimal" value={filters.priceMax} onChange={(e) => setFilters({ ...filters, priceMax: e.target.value })} aria-label="Precio máximo" />
              </div>
            </div>
          </div>
          {brands.length > 0 && (
            <div>
              <h4>Fabricante</h4>
              <div className="stack" style={{ gap: 6, maxHeight: 180, overflowY: "auto" }}>
                {brands.map((b) => <label key={b} className="check"><input type="checkbox" checked={filters.brands.includes(b)} onChange={() => toggleList("brands", b)} />{b}</label>)}
              </div>
            </div>
          )}
          {suppliers.length > 0 && (
            <div>
              <h4>Proveedor</h4>
              <div className="stack" style={{ gap: 6, maxHeight: 180, overflowY: "auto" }}>
                {suppliers.map((b) => <label key={b} className="check"><input type="checkbox" checked={filters.suppliers.includes(b)} onChange={() => toggleList("suppliers", b)} />{b}</label>)}
              </div>
            </div>
          )}
          <div>
            <h4>Ubicación del proveedor</h4>
            <input className="input" placeholder="Provincia o ciudad" value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} aria-label="Ubicación" />
          </div>
          <Button size="sm" variant="ghost" onClick={() => setFilters(defaultFilters)}>Restablecer filtros</Button>
        </div>
      </aside>
      <div className="stack" style={{ gap: 22 }}>
        {res.status === "sin_resultados" && <NoResults res={res} onRegister={onRegister} />}
        {cols.map((c) => (
          <section key={c.key} className="col-group" aria-label={c.title}>
            <div className="col-head">
              <span className="col-letter">{c.letter}</span>
              <h3>{c.title}</h3>
              <span className="badge">{c.list.length}{c.list.length !== c.total ? ` de ${c.total}` : ""}</span>
            </div>
            {c.list.length ? c.list.map((i) => (
              <ResultCard key={i.id} item={i} searchId={res.id} inCompare={compare.some((x) => x.id === i.id)} onCompare={() => onToggleCompare(i)} onQuote={() => onQuote(i)} />
            )) : (
              <div className="card card-pad small muted">
                {c.total ? "Ningún resultado con los filtros actuales." : c.key === "oem"
                  ? <span>No hay referencia OEM en los catálogos cargados. {res.vehicle && res.part?.code && <button className="btn btn-sm" onClick={onRegister}><Plus size={14} />Registrar referencia OEM</button>}</span>
                  : c.key === "iam" ? "No hay equivalencias ni tarifas de recambio nuevo para esta referencia en las fuentes conectadas."
                    : "Ningún centro CAT o desguace conectado tiene esta pieza."}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function NoResults({ res, onRegister }: { res: SearchResponse; onRegister: () => void }) {
  const integ = useQuery({ queryKey: ["integrations"], queryFn: () => api.get<any>("/integrations") });
  const manual = (integ.data?.sources ?? []).filter((s: any) => s.config?.manual_url);
  return (
    <Card title="Sin resultados en las fuentes conectadas" icon={<Database size={16} color="var(--amber)" />}>
      <div className="stack">
        <p className="muted">AUTORECA no inventa referencias: solo muestra lo que existe en los catálogos, tarifas e inventario cargados. Para resolver esta búsqueda puede:</p>
        <div className="row row-wrap">
          {res.vehicle && res.part?.code && <Button variant="primary" icon={<Plus size={16} />} onClick={onRegister}>Registrar referencia OEM consultada</Button>}
          <Link className="btn" to="/integraciones"><Database size={16} />Importar catálogos o tarifas</Link>
          {manual.map((s: any) => (
            <a key={s.id} className="btn" href={s.config.manual_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Consultar en {s.name}</a>
          ))}
        </div>
        <p className="tiny dim">Al registrar la referencia queda guardada para este modelo y código de motor: la próxima búsqueda la encontrará automáticamente.</p>
      </div>
    </Card>
  );
}

function ResultCard({ item, searchId, inCompare, onCompare, onQuote }: { item: ResultItem; searchId: string | null; inCompare: boolean; onCompare: () => void; onQuote: () => void }) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const sup = item.supplier;
  async function save() {
    setSaving(true);
    try {
      await api.post("/search/saved", { searchId: searchId ?? undefined, item });
      toast.ok("Resultado guardado en «Guardados»");
    } catch (e) { toast.err(e); } finally { setSaving(false); }
  }
  const mailto = sup?.email ? `mailto:${sup.email}?subject=${encodeURIComponent(`Consulta referencia ${item.ref ?? item.oemRef ?? ""}`)}&body=${encodeURIComponent(`Hola,\n\n¿Tienen disponible ${item.name}${item.ref ? ` (ref. ${item.ref})` : ""}${item.oemRef ? `, OEM ${item.oemRef}` : ""}? Precio y plazo de entrega, por favor.\n\nGracias.`)}` : null;
  const canContact = !!(sup?.phone || mailto || sup?.website || item.externalUrl);
  return (
    <article className={`rcard ${item.compat.status}`}>
      <div className="thumb">
        {item.imageUrl ? <img src={item.imageUrl} alt={item.name} loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          : item.kind === "inventario" ? <Package size={26} /> : item.category === "cat" ? <Recycle size={26} /> : item.kind === "referencia" ? <Hash size={26} /> : <ImageOff size={24} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="row row-wrap" style={{ gap: 8 }}>
          <span className="title">{item.name}</span>
          <CompatBadge status={item.compat.status} />
          {item.condition === "usado" && <Badge tone="blue">Usado</Badge>}
          {item.kind === "inventario" && <Badge tone="lime">Inventario propio</Badge>}
        </div>
        <div className="refline">
          {item.brand && <span className="strong">{item.brand}</span>}
          {item.ref && <span className="ref">{item.ref}</span>}
          {item.oemRef && item.oemRef !== item.ref?.replace(/[^A-Z0-9]/gi, "").toUpperCase() && <span className="muted small">OEM <span className="mono">{item.oemRef}</span></span>}
          {item.supersededBy && <Badge tone="amber">Sustituida por {item.supersededBy}</Badge>}
          {!!item.replaces?.length && <Badge>Sustituye a {item.replaces.join(", ")}</Badge>}
        </div>
        <div className="meta">
          <span title="Fuente de los datos"><Database size={12} />{item.source.label}{item.source.verified && <BadgeCheck size={12} color="var(--lime)" />}</span>
          {item.updatedAt && <span title="Fecha de actualización"><Clock size={12} />{ago(item.updatedAt)}</span>}
          {sup && <span><Truck size={12} />{sup.name}</span>}
          {item.location && <span><MapPin size={12} />{item.location}</span>}
          {item.donor && (item.donor.make || item.donor.model) && <span><Car size={12} />Donante: {[item.donor.make, item.donor.model, item.donor.year, item.donor.engineCode].filter(Boolean).join(" ")}</span>}
        </div>
        {open && (
          <div className="compat-detail">
            {item.compat.matched.length > 0 && <div><b style={{ color: "var(--lime)" }}>Coincide:</b><ul>{item.compat.matched.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
            {item.compat.conflicts.length > 0 && <div><b style={{ color: "var(--red)" }}>Incompatibilidades:</b><ul>{item.compat.conflicts.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
            {item.compat.missing.length > 0 && <div><b style={{ color: "var(--amber)" }}>Falta para confirmar:</b><ul>{item.compat.missing.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
            {item.compat.evidence.length > 0 && <div className="dim">Evidencia: {item.compat.evidence.join(" · ")}</div>}
            {Object.keys(item.specs).length > 0 && <div><b>Características:</b> {Object.entries(item.specs).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ")}</div>}
            {item.notes.map((n, i) => <div key={i} className="dim">{n}</div>)}
            <div className="dim">Actualizado: {dateTime(item.updatedAt)}</div>
          </div>
        )}
      </div>
      <div className="price-col">
        {item.price != null ? (
          <div className="price">{eur(item.price)}<span className="tiny dim" style={{ fontFamily: "var(--font)", fontWeight: 500 }}> sin IVA</span></div>
        ) : <div className="price none">Sin precio en las fuentes conectadas</div>}
        <span className="small" style={{ color: (item.stock ?? 0) > 0 ? "var(--lime)" : "var(--text-3)" }}>{item.availability ?? "Disponibilidad no informada"}</span>
        <div className="actions">
          <Button size="sm" variant="ghost" icon={open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} onClick={() => setOpen(!open)}>Detalles</Button>
          <Button size="sm" icon={<FilePlus2 size={14} />} onClick={onQuote} disabled={item.compat.status === "no_compatible"} title={item.compat.status === "no_compatible" ? "No se puede presupuestar una pieza no compatible" : "Añadir al presupuesto"}>Presupuesto</Button>
          <Button size="sm" variant={inCompare ? "primary" : "default"} iconOnly icon={<GitCompare size={14} />} onClick={onCompare} title="Comparar referencias" aria-label="Comparar" />
          <Button size="sm" iconOnly icon={<Save size={14} />} loading={saving} onClick={save} title="Guardar resultado" aria-label="Guardar" />
          {canContact && (
            <div style={{ position: "relative" }}>
              <Button size="sm" iconOnly icon={<Phone size={14} />} onClick={() => setContact(!contact)} title="Consultar proveedor" aria-label="Consultar proveedor" />
              {contact && (
                <div className="card" style={{ position: "absolute", right: 0, top: 36, zIndex: 30, padding: 6, minWidth: 220, boxShadow: "var(--shadow)" }} onMouseLeave={() => setContact(false)}>
                  {sup?.phone && <a className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start" }} href={`tel:${sup.phone.replace(/\s/g, "")}`}><Phone size={14} />Llamar {sup.phone}</a>}
                  {mailto && <a className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start" }} href={mailto}><Mail size={14} />Enviar correo</a>}
                  {item.externalUrl && <a className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start" }} href={item.externalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Ver ficha del proveedor</a>}
                  {sup?.website && <a className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start" }} href={sup.website} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Web del proveedor</a>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function CompareModal({ items, parts, onClose }: { items: ResultItem[]; parts: PartType[]; onClose: () => void }) {
  const specKeys = [...new Set(items.flatMap((i) => Object.keys(i.specs)))];
  const label = (k: string) => parts.flatMap((p) => p.specs).find((s) => s.key === k)?.label ?? k.replace(/_/g, " ");
  const rows: [string, (i: ResultItem) => string][] = [
    ["Categoría", (i) => (i.category === "oem" ? "Original OEM" : i.category === "iam" ? "Equivalente IAM" : "Usado CAT")],
    ["Fabricante", (i) => i.brand ?? "—"], ["Referencia", (i) => i.ref ?? "—"], ["Referencia OEM", (i) => i.oemRef ?? "—"],
    ["Compatibilidad", (i) => ({ confirmada: "Confirmada", pendiente: "Pendiente", no_compatible: "No compatible" })[i.compat.status]],
    ["Precio", (i) => eur(i.price)], ["Disponibilidad", (i) => i.availability ?? "—"], ["Proveedor", (i) => i.supplier?.name ?? (i.kind === "inventario" ? "Inventario propio" : "—")],
    ["Estado", (i) => i.condition ?? "—"], ["Fuente", (i) => i.source.label],
    ...specKeys.map((k) => [label(k), (i: ResultItem) => (i.specs[k] != null ? String(i.specs[k]) : "—")] as [string, (i: ResultItem) => string]),
    ["Falta para confirmar", (i) => i.compat.missing.join("; ") || "—"],
  ];
  return (
    <Modal title="Comparar referencias" onClose={onClose} size="wide">
      <div className="table-wrap">
        <table className="table compare-table">
          <thead><tr><th></th>{items.map((i) => <th key={i.id}>{i.brand ?? ""} {i.ref ?? ""}</th>)}</tr></thead>
          <tbody>
            {rows.map(([name, fn]) => {
              const vals = items.map(fn);
              const differs = new Set(vals.filter((v) => v !== "—")).size > 1;
              return (
                <tr key={name}><td className="dim strong">{name}</td>{vals.map((v, i) => <td key={i} className={differs && specKeys.some((k) => label(k) === name) ? "diff" : ""}>{v}</td>)}</tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="tiny dim mt">Las características técnicas que no coinciden entre referencias se resaltan en ámbar. Solo se comparan datos presentes en las fuentes.</p>
    </Modal>
  );
}

function AddToQuote({ item, vehicleId, customerId, onClose }: { item: ResultItem; vehicleId: string | null; customerId: string | null; onClose: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const drafts = useQuery({ queryKey: ["quotes", "borrador"], queryFn: () => api.get<any[]>("/quotes?status=borrador") });
  const company = useQuery({ queryKey: ["company"], queryFn: () => api.get<{ defaultMargin: number }>("/settings/company") });
  const [quoteId, setQuoteId] = useState("");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState(item.price != null ? String(item.price) : "");
  const [margin, setMargin] = useState<string>("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (company.data && margin === "") setMargin(item.kind === "inventario" ? "0" : String(company.data.defaultMargin));
  }, [company.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const computed = cost !== "" && margin !== "" ? Math.round(Number(cost.replace(",", ".")) * (1 + Number(margin.replace(",", ".")) / 100) * 100) / 100 : null;
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const q = await api.post<{ id: string; number: string }>("/quotes/add-line", {
        quote_id: quoteId || undefined, vehicle_id: vehicleId, customer_id: customerId,
        line: {
          description: item.name, brand: item.brand, ref: item.ref, oem_ref: item.oemRef, condition: item.condition, supplier_id: item.supplier?.id ?? null,
          source_label: item.source.label, cost_price: item.kind === "inventario" ? null : cost || null, margin_pct: item.kind === "inventario" ? null : margin || null,
          unit_price: price || (item.kind === "inventario" ? cost : null) || computed, quantity: qty,
        },
      });
      toast.ok(`Añadido al presupuesto ${q.number}`);
      onClose();
      if (!quoteId) nav(`/presupuestos/${q.id}`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title="Añadir al presupuesto" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={submit}>Añadir</Button></>}>
      <div className="stack">
        <div className="card card-pad"><b>{item.name}</b><div className="small muted">{[item.brand, item.ref, item.oemRef && `OEM ${item.oemRef}`].filter(Boolean).join(" · ")}</div></div>
        {item.compat.status !== "confirmada" && <Alert tone="amber">La compatibilidad está pendiente de verificar. Revísela antes de enviar el presupuesto al cliente.</Alert>}
        <Field label="Presupuesto">
          <select className="select" value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
            <option value="">Nuevo presupuesto</option>
            {drafts.data?.map((q) => <option key={q.id} value={q.id}>{q.number} · {q.customer_name ?? "sin cliente"}</option>)}
          </select>
        </Field>
        <div className="grid g4">
          <Field label="Cantidad"><input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label={item.kind === "inventario" ? "Precio venta" : "Coste"}><input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
          {item.kind !== "inventario" && <Field label="Margen %"><input className="input" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} /></Field>}
          <Field label="Precio unitario" hint={computed != null && item.kind !== "inventario" ? `Calculado: ${eur(computed)}` : undefined}>
            <input className="input" inputMode="decimal" placeholder={computed != null ? String(computed) : ""} value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function RegisterOem({ vehicle, partCode, partName, side, axle, onClose, onDone }: {
  vehicle: Vehicle; partCode: string; partName: string; side: string | null; axle: string | null; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({ oemRef: "", description: `${partName}${axle ? ` ${axle}` : ""}${side ? ` ${side}` : ""}`, supersededBy: "", sourceNote: "", verified: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/search/register-oem", { vehicleId: vehicle.id, partCode, oemRef: f.oemRef, description: f.description, verified: f.verified,
        sourceNote: f.sourceNote || undefined, supersededBy: f.supersededBy || undefined, side: side ?? undefined, axle: axle ?? undefined });
      toast.ok("Referencia OEM registrada");
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title="Registrar referencia OEM" onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!f.oemRef} onClick={submit}>Registrar y buscar</Button></>}>
      <div className="stack">
        <Alert tone="blue">Se guardará como aplicación para <b>{[vehicle.make, vehicle.model, vehicle.generation, vehicle.engine_code].filter(Boolean).join(" ")}</b>. Indique la referencia exactamente como aparece en el despiece original.</Alert>
        {!vehicle.engine_code && <Alert tone="amber">El vehículo no tiene código de motor: la referencia no podrá validarse como «confirmada» hasta completarlo.</Alert>}
        <div className="grid g2">
          <Field label="Referencia OEM"><input className="input mono" value={f.oemRef} onChange={(e) => setF({ ...f, oemRef: e.target.value })} /></Field>
          <Field label="Sustituida por (opcional)"><input className="input mono" value={f.supersededBy} onChange={(e) => setF({ ...f, supersededBy: e.target.value })} /></Field>
          <Field label="Descripción" className="span2"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Origen de la consulta" className="span2" hint="Ej.: catálogo del concesionario, etiqueta de la pieza…"><input className="input" value={f.sourceNote} onChange={(e) => setF({ ...f, sourceNote: e.target.value })} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.verified} onChange={(e) => setF({ ...f, verified: e.target.checked })} />He comprobado esta referencia en el catálogo original del fabricante para este bastidor</label>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function PhotoSearch({ aiAvailable, onSearchRef, onSearchPart }: { aiAvailable: boolean; onSearchRef: (r: string) => void; onSearchPart: (name: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [result, setResult] = useState<any>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setResult(null);
    setPreview(URL.createObjectURL(f));
  }
  async function analyze() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      setResult(await api.post("/search/photo", fd));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  if (!aiAvailable) {
    return (
      <Alert tone="amber">
        <b>Búsqueda por fotografía no disponible.</b> Requiere configurar la clave de la API de Claude (variable <code>ANTHROPIC_API_KEY</code>) en el servidor. Mientras tanto, busque por referencia o por vehículo + pieza. Consulte <Link to="/integraciones">Integraciones</Link>.
      </Alert>
    );
  }
  return (
    <div className="grid g2">
      <div className={`dropzone ${over ? "over" : ""}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
        {preview ? <img src={preview} alt="Pieza" style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 10 }} /> : (
          <div className="stack" style={{ alignItems: "center" }}><Camera size={30} color="var(--lime)" /><b>Haga una foto o arrastre una imagen</b><span className="small">Mejor si se ve la etiqueta con la referencia</span></div>
        )}
      </div>
      <div className="stack">
        <Button variant="primary" size="lg" disabled={!file} loading={busy} icon={<Sparkles size={18} />} onClick={analyze}>Analizar fotografía</Button>
        <ErrorBox error={err} />
        {result && (
          <div className="card card-pad stack">
            <div className="row between"><b>{result.part_name ?? "Pieza no identificada"}</b><Badge tone={result.certainty === "alta" ? "lime" : "amber"}>Certeza {result.certainty}</Badge></div>
            {result.visible_references.length ? (
              <div className="stack" style={{ gap: 6 }}>
                <span className="label">Referencias leídas en la imagen</span>
                {result.visible_references.map((r: any, i: number) => (
                  <div key={i} className="row between">
                    <span><span className="mono strong">{r.text}</span> <span className="tiny dim">{r.brand_on_label} {r.kind === "oem" ? "· posible OEM" : r.kind === "fabricante_iam" ? "· fabricante" : ""}</span></span>
                    <Button size="sm" icon={<SearchIcon size={13} />} onClick={() => onSearchRef(r.text)}>Buscar</Button>
                  </div>
                ))}
              </div>
            ) : <span className="small muted">No se lee ninguna referencia en la imagen.</span>}
            {result.part_name && <Button size="sm" onClick={() => onSearchPart(result.part_name)}>Buscar «{result.part_name}» para un vehículo</Button>}
            <p className="small muted">{result.observations}</p>
            <p className="tiny dim">{result.disclaimer}</p>
          </div>
        )}
      </div>
    </div>
  );
}
