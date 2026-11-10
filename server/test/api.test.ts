/**
 * Pruebas de integración de la API contra una base de datos PostgreSQL de pruebas.
 *
 * IMPORTANTE: los datos de catálogo de este archivo son FICTICIOS y existen solo para probar
 * la lógica (referencias con prefijo TEST). Nunca se cargan en la aplicación real.
 *
 * Requiere: TEST_DATABASE_URL (por defecto postgres://postgres@127.0.0.1:5432/autoreca_test)
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/autoreca_test";
process.env.UPLOADS_DIR = "/tmp/autoreca-test-uploads";

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { ensureConnectorRows } = await import("../src/connectors/registry.js");
const { createApp } = await import("../src/app.js");

let server: Server;
let base = "";

class Client {
  cookie = "";
  async req(method: string, url: string, body?: unknown, opts: { csrf?: boolean; form?: FormData } = {}) {
    const headers: Record<string, string> = {};
    if (opts.csrf !== false) headers["X-Requested-With"] = "autoreca";
    if (this.cookie) headers.Cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (opts.form) payload = opts.form;
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const r = await fetch(base + "/api" + url, { method, headers, body: payload });
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const type = r.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await r.json() : type.includes("pdf") ? await r.arrayBuffer() : await r.text();
    return { status: r.status, data: data as any, type };
  }
  get(u: string) { return this.req("GET", u); }
  post(u: string, b?: unknown) { return this.req("POST", u, b ?? {}); }
  put(u: string, b: unknown) { return this.req("PUT", u, b); }
  patch(u: string, b: unknown) { return this.req("PATCH", u, b); }
  del(u: string) { return this.req("DELETE", u); }
  upload(u: string, field: string, name: string, content: string, extra: Record<string, string> = {}) {
    const fd = new FormData();
    fd.append(field, new Blob([content], { type: "text/csv" }), name);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return this.req("POST", u, undefined, { form: fd });
  }
}

const admin = new Client();
const worker = new Client();
const ids: Record<string, string> = {};

// ─── Datos FICTICIOS de prueba ───
const OEM_CSV = `referencia_oem;marca_vehiculo;descripcion;tipo_pieza;modelo;generacion;anio_desde;anio_hasta;codigos_motor;combustible;posicion;verificada;spec_amperaje;sustituida_por
TEST-ALT-001;Volkswagen;Alternador 140A;ALTERNADOR;Golf;V;2003;2009;BXE|BKC;Diésel;;si;140;TEST-ALT-002
TEST-ALT-002;Volkswagen;Alternador 140A (sustituta);ALTERNADOR;Golf;V;2003;2009;BXE|BKC;Diésel;;si;140;
TEST-ALT-001;Volkswagen;Alternador 140A;ALTERNADOR;Touran;;2003;2010;BXE;Diésel;;si;140;TEST-ALT-002
TEST-ALT-900;Volkswagen;Alternador 90A gasolina;ALTERNADOR;Golf;V;2003;2009;BLR;Gasolina;;si;90;
TEST-MIR-L;Volkswagen;Retrovisor izquierdo eléctrico;RETROVISOR;Golf;V;2003;2009;;;izquierdo;si;;
TEST-MIR-R;Volkswagen;Retrovisor derecho eléctrico;RETROVISOR;Golf;V;2003;2009;;;derecho;si;;
fila-mala;;;;;;;;;;;;;
`;
const IAM_CSV = `referencia_oem;marca_iam;referencia_iam;descripcion;verificada;spec_amperaje
TEST-ALT-001;MarcaPruebaA;TA 100 200;Alternador equivalente;si;140
TEST-ALT-001;MarcaPruebaB;TB-555;Alternador equivalente;si;180
TEST-ALT-001;MarcaPruebaC;TC777;Alternador equivalente;no;140
`;
const NEW_CSV = `descripcion;referencia;marca;referencia_oem;precio;stock;ubicacion
Alternador 140A;TA100200;MarcaPruebaA;;189,90;4;Madrid
Alternador 180A;TB555;MarcaPruebaB;;150,00;2;Madrid
Alternador original;TEST-ALT-001;Volkswagen;TEST-ALT-001;420,00;1;Madrid
Bomba de agua;TBW-1;MarcaPruebaA;;55,00;10;Madrid
`;
const USED_CSV = `descripcion;referencia_oem;precio;vehiculo_marca;vehiculo_modelo;vehiculo_anio;vehiculo_codigo_motor;ubicacion
ALTERNADOR VW GOLF V 1.9 TDI;TEST-ALT-001;60;Volkswagen;Golf;2006;BXE;Sevilla
ALTERNADOR VW GOLF V;;45;Volkswagen;Golf;2007;BXE;Valencia
ALTERNADOR VW GOLF V GASOLINA;;40;Volkswagen;Golf;2005;BLR;Valencia
`;

before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(false);
  await ensureConnectorRows();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  await pool.end();
});

describe("Autenticación y seguridad", () => {
  it("requiere configuración inicial", async () => {
    const r = await admin.get("/auth/status");
    assert.equal(r.data.needsSetup, true);
  });
  it("rechaza contraseñas débiles", async () => {
    const r = await admin.post("/auth/setup", { name: "Admin", email: "admin@test.local", password: "corta" });
    assert.equal(r.status, 400);
  });
  it("crea el administrador inicial y abre sesión", async () => {
    const r = await admin.post("/auth/setup", { name: "Admin Pruebas", email: "admin@test.local", password: "ClaveSegura123" });
    assert.equal(r.status, 201);
    const me = await admin.get("/auth/me");
    assert.equal(me.data.user.role, "admin");
  });
  it("no permite repetir la configuración inicial", async () => {
    const r = await new Client().post("/auth/setup", { name: "Otro", email: "x@test.local", password: "ClaveSegura123" });
    assert.equal(r.status, 409);
  });
  it("bloquea peticiones sin sesión", async () => {
    const r = await new Client().get("/vehicles");
    assert.equal(r.status, 401);
  });
  it("bloquea peticiones sin cabecera CSRF", async () => {
    const r = await admin.req("POST", "/customers", { name: "X" }, { csrf: false });
    assert.equal(r.status, 403);
  });
  it("crea un trabajador y este inicia sesión", async () => {
    const r = await admin.post("/users", { name: "Trabajador", email: "worker@test.local", role: "worker", password: "ClaveWorker123" });
    assert.equal(r.status, 201);
    ids.worker = r.data.id;
    const l = await worker.post("/auth/login", { email: "worker@test.local", password: "ClaveWorker123" });
    assert.equal(l.status, 200);
  });
  it("rechaza credenciales incorrectas", async () => {
    const r = await new Client().post("/auth/login", { email: "worker@test.local", password: "mal" });
    assert.equal(r.status, 401);
  });
  it("el trabajador no accede a la administración", async () => {
    assert.equal((await worker.get("/users")).status, 403);
    assert.equal((await worker.get("/settings/backup")).status, 403);
  });
  it("recuperación de contraseña con enlace generado por el administrador", async () => {
    const link = await admin.post(`/users/${ids.worker}/reset-link`);
    const token = new URL(link.data.url).searchParams.get("token");
    const c = new Client();
    assert.equal((await c.post("/auth/reset", { token, password: "NuevaClave456" })).status, 200);
    assert.equal((await c.post("/auth/reset", { token, password: "OtraClave789" })).status, 400, "el enlace es de un solo uso");
    assert.equal((await worker.get("/auth/me")).status, 401, "las sesiones previas se cierran");
    assert.equal((await worker.post("/auth/login", { email: "worker@test.local", password: "NuevaClave456" })).status, 200);
  });
});

describe("Proveedores e importación de catálogos", () => {
  it("crea proveedores", async () => {
    const a = await admin.post("/suppliers", { name: "Distribuidor Pruebas", type: "distribuidor", phone: "600000000", email: "ventas@prueba.local", location: "Madrid" });
    assert.equal(a.status, 201);
    ids.supplierNew = a.data.id;
    const b = await admin.post("/suppliers", { name: "CAT Pruebas", type: "cat", location: "Sevilla" });
    ids.supplierCat = b.data.id;
    const bad = await admin.post("/suppliers", { name: "X", type: "nada" });
    assert.equal(bad.status, 400);
  });
  it("crea fuentes de archivo (solo administrador)", async () => {
    assert.equal((await worker.post("/integrations/sources", { name: "W", data_kind: "oem" })).status, 403);
    for (const [k, kind, sup, verified] of [["oem", "oem", null, true], ["iam", "iam", null, false], ["new", "offers_new", ids.supplierNew, false], ["used", "offers_used", ids.supplierCat, false]] as const) {
      const r = await admin.post("/integrations/sources", { name: `Fuente ${k}`, data_kind: kind, supplier_id: sup, verified_source: verified });
      assert.equal(r.status, 201);
      ids[`src_${k}`] = r.data.id;
    }
  });
  it("importa el catálogo OEM e informa de filas erróneas", async () => {
    const r = await admin.upload(`/integrations/sources/${ids.src_oem}/import`, "file", "oem.csv", OEM_CSV);
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, 6);
    assert.equal(r.data.errors.length, 1);
    assert.equal(r.data.errors[0].fila, 8);
  });
  it("importa equivalencias, tarifa nueva y stock usado", async () => {
    assert.equal((await admin.upload(`/integrations/sources/${ids.src_iam}/import`, "file", "iam.csv", IAM_CSV)).data.ok, 3);
    assert.equal((await admin.upload(`/integrations/sources/${ids.src_new}/import`, "file", "new.csv", NEW_CSV, { mode: "reemplazar" })).data.ok, 4);
    assert.equal((await admin.upload(`/integrations/sources/${ids.src_used}/import`, "file", "used.csv", USED_CSV, { mode: "reemplazar" })).data.ok, 3);
  });
  it("reemplazar no duplica", async () => {
    await admin.upload(`/integrations/sources/${ids.src_new}/import`, "file", "new.csv", NEW_CSV, { mode: "reemplazar" });
    const t = await admin.post(`/integrations/sources/${ids.src_new}/test`);
    assert.match(t.data.message, /^4 registros/);
  });
  it("rechaza archivos con columnas obligatorias ausentes", async () => {
    const r = await admin.upload(`/integrations/sources/${ids.src_iam}/import`, "file", "x.csv", "a;b\n1;2\n");
    assert.equal(r.data.ok, 0);
    assert.match(r.data.errors[0].error, /Faltan columnas/);
  });
  it("los conectores con licencia no se pueden activar ni simular", async () => {
    const list = await admin.get("/integrations");
    const tecdoc = list.data.sources.find((s: any) => s.connector_key === "tecdoc");
    const r = await admin.put(`/integrations/sources/${tecdoc.id}`, { enabled: true });
    assert.equal(r.status, 409);
    const t = await admin.post(`/integrations/sources/${tecdoc.id}/test`);
    assert.equal(t.data.ok, false);
    const c = await admin.put(`/integrations/sources/${tecdoc.id}`, { credentials: { api_key: "secreto" } });
    assert.equal(c.status, 200);
    const again = await admin.get("/integrations");
    const t2 = again.data.sources.find((s: any) => s.connector_key === "tecdoc");
    assert.equal(t2.has_credentials, true);
    assert.equal(JSON.stringify(again.data).includes("secreto"), false, "las credenciales nunca se devuelven");
  });
});

describe("Buscador inteligente", () => {
  const VIN = "WVWZZZ1KZ6W000001";
  it("VIN sin datos técnicos: identifica marca y pide aclaración con versiones posibles", async () => {
    const r = await worker.post("/search", { vehicle: VIN, part: "alternador" });
    assert.equal(r.status, 200);
    assert.equal(r.data.vehicle.make, "Volkswagen");
    assert.equal(r.data.vehicle.identification_level, "parcial");
    assert.ok(r.data.clarification.candidates.length > 0, "ofrece versiones");
    assert.equal(r.data.part.code, "ALTERNADOR");
    assert.ok(r.data.results.oem.length > 0);
    assert.ok(r.data.results.oem.every((x: any) => x.compat.status !== "confirmada"), "sin datos suficientes nunca confirma");
    ids.vehicle = r.data.vehicle.id;
  });
  it("con modelo, año y código de motor confirma solo lo que tiene evidencia", async () => {
    const r = await worker.post("/search", { vehicleId: ids.vehicle, part: "alternador", vehicleData: { model: "Golf", generation: "V", year: 2006, engine_code: "BXE", fuel: "Diésel" } });
    const { oem, iam, cat } = r.data.results;
    const byRef = (l: any[], ref: string) => l.find((x) => x.kind === "referencia" && (x.ref ?? "").replace(/[^A-Z0-9]/g, "") === ref);
    assert.equal(byRef(oem, "TESTALT001").compat.status, "confirmada");
    assert.equal(byRef(oem, "TESTALT001").supersededBy, "TESTALT002");
    assert.equal(byRef(oem, "TESTALT900").compat.status, "no_compatible", "motor de gasolina distinto");
    const a = iam.find((x: any) => x.brand === "MarcaPruebaA");
    assert.equal(a.compat.status, "confirmada");
    assert.equal(a.price, 189.9);
    assert.equal(a.supplier.name, "Distribuidor Pruebas");
    const b = iam.find((x: any) => x.brand === "MarcaPruebaB");
    assert.equal(b.compat.status, "no_compatible", "amperaje distinto");
    assert.ok(b.compat.conflicts.some((c: string) => c.includes("Amperaje")));
    const c = iam.find((x: any) => x.brand === "MarcaPruebaC");
    assert.equal(c.compat.status, "pendiente", "equivalencia no verificada");
    assert.equal(c.price, null, "no se inventan precios");
    const orig = oem.find((x: any) => x.kind === "oferta");
    assert.equal(orig.price, 420);
    const usedByRef = cat.find((x: any) => x.oemRef === "TESTALT001");
    assert.equal(usedByRef.compat.status, "confirmada");
    const usedDonor = cat.find((x: any) => x.location === "Valencia" && x.donor.engineCode === "BXE");
    assert.equal(usedDonor.compat.status, "pendiente");
    const usedGas = cat.find((x: any) => x.donor?.engineCode === "BLR");
    assert.equal(usedGas.compat.status, "no_compatible");
    assert.ok(!iam.some((x: any) => x.name === "Bomba de agua"), "no mezcla otras piezas");
  });
  it("respeta el lado de montaje", async () => {
    const r = await worker.post("/search", { vehicleId: ids.vehicle, part: "retrovisor izquierdo" });
    assert.equal(r.data.part.side, "izquierdo");
    const l = r.data.results.oem.find((x: any) => x.ref === "TEST-MIR-L");
    const d = r.data.results.oem.find((x: any) => x.ref === "TEST-MIR-R");
    assert.notEqual(l.compat.status, "no_compatible");
    assert.equal(d.compat.status, "no_compatible");
  });
  it("corrige faltas de ortografía", async () => {
    const r = await worker.post("/search", { vehicleId: ids.vehicle, part: "alternadro" });
    assert.equal(r.data.part.code, "ALTERNADOR");
    assert.equal(r.data.part.method, "correccion_ortografica");
  });
  it("reconoce sinónimos", async () => {
    const r = await worker.post("/search", { vehicleId: ids.vehicle, part: "compresor del aire" });
    assert.equal(r.data.part.code, "COMPRESOR_AC");
    const r2 = await worker.post("/search", { vehicleId: ids.vehicle, part: "faro delantero derecho" });
    assert.equal(r2.data.part.code, "FARO_DELANTERO");
    assert.equal(r2.data.part.side, "derecho");
  });
  it("busca por referencia IAM y llega a la OEM", async () => {
    const r = await worker.post("/search", { ref: "TA-100-200" });
    assert.ok(r.data.oemRefs.includes("TESTALT001"));
    assert.ok(r.data.results.iam.length > 0);
  });
  it("una referencia escrita en el campo de pieza se trata como referencia", async () => {
    const r = await worker.post("/search", { vehicleId: ids.vehicle, part: "TA100200" });
    assert.ok(r.data.oemRefs.includes("TESTALT001"));
  });
  it("matrícula desconocida: pide los datos mínimos y después crea el vehículo", async () => {
    const r = await worker.post("/search", { vehicle: "1234 BCD", part: "alternador" });
    assert.equal(r.data.status, "requiere_vehiculo");
    assert.equal(r.data.clarification.canCreateFromPlate, "1234BCD");
    const r2 = await worker.post("/search", { vehicle: "1234BCD", part: "alternador", vehicleData: { make: "Volkswagen", model: "Golf", year: 2006, engine_code: "BXE", fuel: "Diésel" } });
    assert.equal(r2.data.vehicle.plate, "1234BCD");
    assert.equal(r2.data.status, "completado");
    const r3 = await worker.post("/search", { vehicle: "1234-BCD", part: "alternador" });
    assert.equal(r3.data.vehicle.id, r2.data.vehicle.id, "la siguiente vez la reconoce");
  });
  it("rechaza entradas no válidas", async () => {
    assert.equal((await worker.post("/search", {})).status, 400);
    const r = await worker.post("/search", { vehicle: "hola", part: "alternador" });
    assert.equal(r.data.status, "requiere_vehiculo");
  });
  it("pieza desconocida pide seleccionar el tipo", async () => {
    const r = await worker.post("/search", { vehicleId: ids.vehicle, part: "cosa rara" });
    assert.equal(r.data.status, "requiere_pieza");
  });
  it("registro manual de OEM: la siguiente búsqueda la encuentra", async () => {
    const before = await worker.post("/search", { vehicleId: ids.vehicle, part: "bomba de agua" });
    assert.equal(before.data.results.oem.length, 0);
    const reg = await worker.post("/search/register-oem", { vehicleId: ids.vehicle, partCode: "BOMBA_AGUA", oemRef: "TEST-WP-1", description: "Bomba de agua", verified: true });
    assert.equal(reg.status, 201);
    const after = await worker.post("/search", { vehicleId: ids.vehicle, part: "bomba de agua" });
    assert.equal(after.data.results.oem.length, 1);
    assert.equal(after.data.results.oem[0].compat.status, "confirmada");
  });
  it("búsqueda por foto sin IA configurada devuelve 503 claro", async () => {
    const fd = new FormData();
    fd.append("photo", new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), "p.jpg");
    const r = await worker.req("POST", "/search/photo", undefined, { form: fd });
    assert.equal(r.status, 503);
  });
  it("el historial recupera una búsqueda", async () => {
    const h = await worker.get("/history");
    assert.ok(h.data.length >= 5);
    const one = await worker.get(`/search/history/${h.data[0].id}`);
    assert.equal(one.status, 200);
    assert.equal(one.data.fromHistory, true);
  });
  it("guarda resultados", async () => {
    const s = await worker.post("/search/saved", { item: { name: "x" } });
    assert.equal(s.status, 201);
    assert.equal((await worker.get("/search/saved")).data.length, 1);
  });
});

describe("Inventario", () => {
  it("CRUD con validación y permisos", async () => {
    const bad = await worker.post("/inventory", { description: "", condition: "nuevo", quantity: 1 });
    assert.equal(bad.status, 400);
    const r = await worker.post("/inventory", { description: "Alternador 140A", condition: "usado", oem_ref: "TEST-ALT-001", sale_price: "75,50", purchase_price: "30", quantity: 2, location: "B-12", vehicle_make: "Volkswagen", vehicle_model: "Golf" });
    assert.equal(r.status, 201);
    assert.equal(r.data.part_code, "ALTERNADOR", "detecta el tipo por la descripción");
    assert.equal(r.data.sale_price, 75.5);
    ids.inv = r.data.id;
    const adj = await worker.patch(`/inventory/${ids.inv}/quantity`, { delta: -3 });
    assert.equal(adj.status, 400, "no permite stock negativo");
    assert.equal((await worker.patch(`/inventory/${ids.inv}/quantity`, { delta: -1 })).data.quantity, 1);
    assert.equal((await worker.del(`/inventory/${ids.inv}`)).status, 403, "eliminar requiere administrador");
  });
  it("aparece en el buscador como usado de inventario propio", async () => {
    const r = await worker.post("/search", { vehicleId: ids.vehicle, part: "alternador" });
    const inv = r.data.results.cat.find((x: any) => x.kind === "inventario");
    assert.ok(inv);
    assert.equal(inv.compat.status, "confirmada");
  });
  it("sube y sirve fotografías validando el formato", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
    const fd = new FormData();
    fd.append("photos", new Blob([png], { type: "image/png" }), "foto.png");
    const up = await worker.req("POST", `/inventory/${ids.inv}/photos`, undefined, { form: fd });
    assert.equal(up.status, 201);
    const f = await fetch(`${base}/api/files/${up.data.ids[0]}`, { headers: { Cookie: worker.cookie } });
    assert.equal(f.status, 200);
    assert.equal(f.headers.get("content-type"), "image/png");
    const fake = new FormData();
    fake.append("photos", new Blob([Buffer.from("no soy una imagen")], { type: "image/png" }), "x.png");
    assert.equal((await worker.req("POST", `/inventory/${ids.inv}/photos`, undefined, { form: fake })).status, 400);
  });
});

describe("Presupuestos y pedidos", () => {
  it("añade líneas desde el buscador, calcula totales y genera PDF", async () => {
    const c = await worker.post("/customers", { name: "Taller Pruebas", phone: "611111111", email: "taller@prueba.local" });
    ids.customer = c.data.id;
    const q = await worker.post("/quotes/add-line", { vehicle_id: ids.vehicle, customer_id: ids.customer, line: { description: "Alternador", brand: "MarcaPruebaA", ref: "TA100200", cost_price: 100, margin_pct: 30, quantity: 2 } });
    assert.equal(q.status, 201);
    assert.equal(q.data.lines[0].unit_price, 130);
    ids.quote = q.data.id;
    const q2 = await worker.post("/quotes/add-line", { quote_id: ids.quote, line: { description: "Bomba", unit_price: 50, quantity: 1, discount_pct: 10 } });
    assert.equal(q2.data.totals.subtotal, 305);
    const u = await worker.put(`/quotes/${ids.quote}`, { customer_id: ids.customer, vehicle_id: ids.vehicle, vat_rate: 21, global_discount_pct: 10, notes: "Prueba", lines: q2.data.lines });
    assert.equal(u.data.totals.base, 274.5);
    assert.equal(u.data.totals.vat, 57.65);
    assert.equal(u.data.totals.total, 332.15);
    const pdf = await worker.get(`/quotes/${ids.quote}/pdf`);
    assert.equal(pdf.status, 200);
    assert.match(pdf.type, /pdf/);
    assert.ok((pdf.data as ArrayBuffer).byteLength > 1000);
  });
  it("solo convierte presupuestos aceptados y bloquea el original", async () => {
    assert.equal((await worker.post(`/quotes/${ids.quote}/convert`)).status, 409);
    await worker.patch(`/quotes/${ids.quote}/status`, { status: "aceptado" });
    const o = await worker.post(`/quotes/${ids.quote}/convert`);
    assert.equal(o.status, 201);
    assert.equal(o.data.lines.length, 2);
    assert.equal(o.data.totals.total, 332.15);
    ids.order = o.data.id;
    assert.equal((await worker.put(`/quotes/${ids.quote}`, { vat_rate: 21, lines: [] })).status, 409);
    assert.equal((await worker.post(`/quotes/${ids.quote}/convert`)).status, 409);
    const st = await worker.patch(`/orders/${ids.order}`, { status: "entregado" });
    assert.equal(st.data.status, "entregado");
    assert.equal((await worker.get(`/orders/${ids.order}/pdf`)).status, 200);
  });
  it("duplica presupuestos", async () => {
    const d = await worker.post(`/quotes/${ids.quote}/duplicate`);
    assert.equal(d.status, 201);
    assert.equal(d.data.status, "borrador");
    assert.equal(d.data.lines.length, 2);
  });
});

describe("Módulos de consulta", () => {
  it("vehículos, OEM, IAM, CAT, clientes, proveedores", async () => {
    assert.ok((await worker.get("/vehicles")).data.length >= 2);
    const v = await worker.get(`/vehicles/${ids.vehicle}`);
    assert.ok(v.data.searches.length > 0);
    const oem = await worker.get("/catalog/oem?q=TEST-ALT");
    assert.ok(oem.data.length >= 3);
    const det = await worker.get(`/catalog/oem/${oem.data[0].id}`);
    assert.ok(det.data.applications.length > 0);
    assert.equal((await worker.get("/catalog/iam?brand=MarcaPruebaA")).data.length, 1);
    const cat = await worker.get("/catalog/cat?q=golf");
    assert.ok(cat.data.offers.length >= 3);
    const cust = await worker.get(`/customers/${ids.customer}`);
    assert.equal(cust.data.quotes.length, 2);
    const sup = await worker.get(`/suppliers/${ids.supplierNew}`);
    assert.equal(sup.data.dataSources.length, 1);
  });
  it("alta manual de OEM con aplicaciones e IAM", async () => {
    const r = await worker.post("/catalog/oem", { oem_ref: "TEST-X-1", vehicle_make: "Renault", description: "Prueba", part_code: "TURBO", verified: false, applications: [{ make: "Renault", model: "Megane", engine_codes: ["K9K"] }] });
    assert.equal(r.status, 201);
    const x = await worker.post("/catalog/iam", { oem_ref: "TEST-X-1", iam_brand: "MarcaPruebaD", iam_ref: "D-1" });
    assert.equal(x.status, 201);
    assert.equal((await worker.patch(`/catalog/iam/${x.data.id}`, { verified: true })).status, 200);
  });
  it("estadísticas, panel, sinónimos y copia de seguridad", async () => {
    const s = await worker.get("/stats?days=30");
    assert.ok(s.data.summary.total > 5);
    assert.ok(s.data.topParts.length > 0);
    assert.equal((await worker.get("/stats/dashboard")).status, 200);
    assert.equal((await worker.post("/settings/synonyms", { term: "burro", part_code: "MOTOR_ARRANQUE" })).status, 201);
    const r = await worker.post("/search", { vehicleId: ids.vehicle, part: "burro" });
    assert.equal(r.data.part.code, "MOTOR_ARRANQUE");
    assert.equal(r.data.part.method, "sinonimo_empresa");
    const b = await admin.get("/settings/backup");
    assert.equal(b.status, 200);
    assert.ok(b.data.data.users.every((u: any) => !("password_hash" in u)));
    assert.ok(b.data.data.data_sources.every((u: any) => !("credentials_enc" in u)));
    const audit = await admin.get("/users/audit");
    assert.ok(audit.data.some((a: any) => a.action === "presupuesto.convertido"));
  });
});
