import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Camera, Minus, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHead, SearchBox, useDebounced, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, eur, num } from "../lib/format";
import { usePartTypes } from "./Search";

export function useSuppliers() {
  return useQuery({ queryKey: ["suppliers", ""], queryFn: () => api.get<{ id: string; name: string; type: string }[]>("/suppliers") });
}

export function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [condition, setCondition] = useState("");
  const [partCode, setPartCode] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [stock, setStock] = useState("");
  const [edit, setEdit] = useState<any | null>(null);
  const parts = usePartTypes();
  const suppliers = useSuppliers();
  const list = useQuery({
    queryKey: ["inventory", dq, condition, partCode, supplierId, stock],
    queryFn: () => api.get<any[]>(`/inventory${qs({ q: dq, condition, part_code: partCode, supplier_id: supplierId, stock })}`),
  });
  useEffect(() => {
    const id = params.get("id");
    if (id) api.get(`/inventory/${id}`).then(setEdit).catch(() => {});
  }, [params]);
  const totalUnits = list.data?.reduce((s, i) => s + i.quantity, 0) ?? 0;
  const totalValue = list.data?.reduce((s, i) => s + i.quantity * (i.purchase_price ?? 0), 0) ?? 0;
  return (
    <>
      <PageHead title="Inventario" subtitle="Recambios propios de la empresa. Se consultan automáticamente en cada búsqueda."
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEdit({ condition: "nuevo", quantity: 1, specs: {} })}>Registrar pieza</Button>} />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Descripción, referencia, marca, ubicación…" />
        <select className="select" style={{ width: 150 }} value={condition} onChange={(e) => setCondition(e.target.value)} aria-label="Estado"><option value="">Nuevo y usado</option><option value="nuevo">Nuevo</option><option value="usado">Usado</option></select>
        <select className="select" style={{ width: 200 }} value={partCode} onChange={(e) => setPartCode(e.target.value)} aria-label="Tipo"><option value="">Todos los tipos</option>{parts.data?.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
        <select className="select" style={{ width: 180 }} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Proveedor"><option value="">Todos los proveedores</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select className="select" style={{ width: 140 }} value={stock} onChange={(e) => setStock(e.target.value)} aria-label="Stock"><option value="">Todo el stock</option><option value="con">Con stock</option><option value="sin">Sin stock</option></select>
        <span className="small dim">{num(list.data?.length)} referencias · {num(totalUnits)} uds. · valor coste {eur(totalValue)}</span>
      </div>
      <Card pad={false}>
        {list.isLoading ? <Loading /> : list.error ? <div className="card-body"><ErrorBox error={list.error} /></div> : list.data!.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th></th><th>Descripción</th><th>Ref. OEM</th><th>Ref. IAM</th><th>Fabricante</th><th>Estado</th><th className="right">Coste</th><th className="right">Venta</th><th className="right">Uds.</th><th>Ubicación</th></tr></thead>
              <tbody>
                {list.data!.map((i) => (
                  <tr key={i.id} className="clickable" onClick={() => { setEdit(i); setParams({ id: i.id }, { replace: true }); }}>
                    <td style={{ width: 52 }}>{i.photos?.[0] ? <img src={`/api/files/${i.photos[0]}`} alt="" style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 7 }} /> : <div style={{ width: 38, height: 38, borderRadius: 7, background: "var(--bg-2)", display: "grid", placeItems: "center" }}><Boxes size={16} color="var(--text-3)" /></div>}</td>
                    <td><div className="strong">{i.description}</div>{i.vehicle_make && <div className="tiny dim">{[i.vehicle_make, i.vehicle_model, i.vehicle_year, i.vehicle_engine_code].filter(Boolean).join(" ")}</div>}</td>
                    <td className="mono small">{i.oem_ref_display ?? "—"}</td>
                    <td className="mono small">{i.iam_ref_display ?? "—"}</td>
                    <td>{i.brand ?? "—"}</td>
                    <td>{i.condition === "usado" ? <Badge tone="blue">Usado</Badge> : <Badge>Nuevo</Badge>}</td>
                    <td className="right">{eur(i.purchase_price)}</td>
                    <td className="right strong">{eur(i.sale_price)}</td>
                    <td className="right"><Badge tone={i.quantity > 1 ? "lime" : i.quantity === 1 ? "amber" : "red"}>{i.quantity}</Badge></td>
                    <td className="small muted">{i.location ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={<Boxes size={22} />} title={q || condition || partCode ? "Sin coincidencias" : "El inventario está vacío"}
          action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEdit({ condition: "nuevo", quantity: 1, specs: {} })}>Registrar pieza</Button>}>Registre las piezas que tiene en almacén para que aparezcan en el buscador.</Empty>}
      </Card>
      {edit && <ItemForm initial={edit} onClose={() => { setEdit(null); setParams({}, { replace: true }); }} />}
    </>
  );
}

function ItemForm({ initial, onClose }: { initial: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const parts = usePartTypes();
  const suppliers = useSuppliers();
  const [f, setF] = useState<Record<string, any>>(() => ({
    sku: "", description: "", part_code: "", brand: "", oem_ref: initial.oem_ref_display ?? "", iam_ref: initial.iam_ref_display ?? "", condition: "nuevo",
    purchase_price: "", sale_price: "", quantity: 1, location: "", supplier_id: "", vehicle_make: "", vehicle_model: "", vehicle_year: "", vehicle_engine_code: "", notes: "",
    ...Object.fromEntries(Object.entries(initial).filter(([k]) => !["oem_ref", "iam_ref"].includes(k)).map(([k, v]) => [k, v ?? ""])),
  }));
  const [specs, setSpecs] = useState<Record<string, string>>(initial.specs ?? {});
  const [photos, setPhotos] = useState<string[]>(initial.photos ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [del, setDel] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const partDef = parts.data?.find((p) => p.code === f.part_code);
  const margin = f.purchase_price && f.sale_price ? ((Number(f.sale_price) - Number(f.purchase_price)) / Number(f.purchase_price)) * 100 : null;

  async function save() {
    setBusy(true);
    setErr(null);
    const body = { ...f, part_code: f.part_code || null, specs: Object.fromEntries(Object.entries(specs).filter(([, v]) => v)), quantity: Number(f.quantity) };
    try {
      const r = initial.id ? await api.put<any>(`/inventory/${initial.id}`, body) : await api.post<any>("/inventory", body);
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.ok(initial.id ? "Pieza actualizada" : "Pieza registrada");
      if (!initial.id) { setF({ ...f, ...r }); initial.id = r.id; }
      else onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function adjust(delta: number) {
    try {
      const r = await api.patch<{ quantity: number }>(`/inventory/${initial.id}/quantity`, { delta });
      setF({ ...f, quantity: r.quantity });
      qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (e) { toast.err(e); }
  }
  async function upload(files: FileList | null) {
    if (!files?.length || !initial.id) return;
    setUploading(true);
    try {
      const fd = new FormData();
      [...files].forEach((x) => fd.append("photos", x));
      const r = await api.post<{ ids: string[] }>(`/inventory/${initial.id}/photos`, fd);
      setPhotos([...photos, ...r.ids]);
      qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (e) { toast.err(e); } finally { setUploading(false); }
  }
  async function removePhoto(fid: string) {
    try {
      await api.del(`/inventory/${initial.id}/photos/${fid}`);
      setPhotos(photos.filter((p) => p !== fid));
      qc.invalidateQueries({ queryKey: ["inventory"] });
    } catch (e) { toast.err(e); }
  }

  return (
    <Modal title={initial.id ? "Ficha de inventario" : "Registrar pieza"} onClose={onClose} size="wide" footer={<>
      {initial.id && user?.role === "admin" && <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => setDel(true)} style={{ marginRight: "auto" }}>Eliminar</Button>}
      <Button onClick={onClose}>Cerrar</Button>
      <Button variant="primary" loading={busy} onClick={save}>{initial.id ? "Guardar cambios" : "Registrar"}</Button>
    </>}>
      <div className="stack">
        <div className="grid g4">
          <Field label="Descripción" className="span2"><input className="input" value={f.description} onChange={set("description")} placeholder="Alternador 140A" /></Field>
          <Field label="Tipo de pieza"><select className="select" value={f.part_code} onChange={set("part_code")}><option value="">Detectar por descripción</option>{parts.data?.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
          <Field label="Estado"><select className="select" value={f.condition} onChange={set("condition")}><option value="nuevo">Nuevo</option><option value="usado">Usado</option></select></Field>
          <Field label="Referencia OEM"><input className="input mono" value={f.oem_ref} onChange={set("oem_ref")} /></Field>
          <Field label="Referencia IAM / fabricante"><input className="input mono" value={f.iam_ref} onChange={set("iam_ref")} /></Field>
          <Field label="Fabricante"><input className="input" value={f.brand} onChange={set("brand")} /></Field>
          <Field label="SKU interno"><input className="input mono" value={f.sku} onChange={set("sku")} /></Field>
          <Field label="Precio de compra (€)"><input className="input" inputMode="decimal" value={f.purchase_price} onChange={set("purchase_price")} /></Field>
          <Field label="Precio de venta (€)" hint={margin != null && Number.isFinite(margin) ? `Margen ${margin.toFixed(1)} %` : undefined}><input className="input" inputMode="decimal" value={f.sale_price} onChange={set("sale_price")} /></Field>
          <Field label="Cantidad">
            {initial.id ? (
              <div className="row"><Button iconOnly icon={<Minus size={14} />} onClick={() => adjust(-1)} disabled={Number(f.quantity) <= 0} aria-label="Restar" /><b style={{ minWidth: 30, textAlign: "center" }}>{f.quantity}</b><Button iconOnly icon={<Plus size={14} />} onClick={() => adjust(1)} aria-label="Sumar" /></div>
            ) : <input className="input" inputMode="numeric" value={f.quantity} onChange={set("quantity")} />}
          </Field>
          <Field label="Ubicación física"><input className="input" value={f.location} onChange={set("location")} placeholder="Estantería B-12" /></Field>
          <Field label="Proveedor" className="span2"><select className="select" value={f.supplier_id ?? ""} onChange={set("supplier_id")}><option value="">—</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          {f.condition === "usado" && <>
            <Field label="Vehículo donante: marca"><input className="input" value={f.vehicle_make} onChange={set("vehicle_make")} /></Field>
            <Field label="Modelo"><input className="input" value={f.vehicle_model} onChange={set("vehicle_model")} /></Field>
            <Field label="Año"><input className="input" inputMode="numeric" value={f.vehicle_year} onChange={set("vehicle_year")} /></Field>
            <Field label="Código de motor"><input className="input mono" value={f.vehicle_engine_code} onChange={set("vehicle_engine_code")} /></Field>
          </>}
        </div>
        {partDef && partDef.specs.length > 0 && (
          <div>
            <div className="label mb">Características técnicas (se usan para validar compatibilidades)</div>
            <div className="grid g4">
              {partDef.specs.map((s) => <Field key={s.key} label={`${s.label}${s.unit ? ` (${s.unit})` : ""}`}><input className="input" value={specs[s.key] ?? ""} onChange={(e) => setSpecs({ ...specs, [s.key]: e.target.value })} /></Field>)}
            </div>
          </div>
        )}
        <Field label="Observaciones"><textarea className="textarea" value={f.notes} onChange={set("notes")} /></Field>
        <div>
          <div className="label mb">Fotografías</div>
          {initial.id ? (
            <div className="photo-grid">
              {photos.map((p) => (
                <div key={p} className="ph"><a href={`/api/files/${p}`} target="_blank" rel="noreferrer"><img src={`/api/files/${p}`} alt="" /></a><Button size="sm" iconOnly icon={<X size={13} />} onClick={() => removePhoto(p)} aria-label="Quitar foto" /></div>
              ))}
              <button className="ph dropzone" style={{ display: "grid", placeItems: "center", padding: 0 }} onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? <span className="spinner" /> : <Camera size={22} />}
              </button>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => upload(e.target.files)} />
            </div>
          ) : <span className="small dim">Registre la pieza para poder añadir fotografías.</span>}
        </div>
        {initial.updated_at && <span className="tiny dim">Última modificación: {dateTime(initial.updated_at)}</span>}
        <ErrorBox error={err} />
      </div>
      {del && <Confirm title="Eliminar pieza" danger confirmLabel="Eliminar" message={`Se eliminará «${f.description}» y sus fotografías.`} onClose={() => setDel(false)}
        onConfirm={async () => { await api.del(`/inventory/${initial.id}`); qc.invalidateQueries({ queryKey: ["inventory"] }); toast.ok("Pieza eliminada"); onClose(); }} />}
    </Modal>
  );
}
