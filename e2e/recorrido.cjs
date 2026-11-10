// Recorrido completo de la interfaz con Playwright sobre una base de datos VACÍA de pruebas.
// Uso: arrancar el servidor contra una BD de pruebas y ejecutar  BASE_URL=http://localhost:3200 node e2e/recorrido.cjs
const { chromium } = require("playwright");
const F = require("./fixtures-prueba.cjs");
const BASE = process.env.BASE_URL || "http://localhost:3200";
const SHOTS = process.env.SHOTS_DIR || require("os").tmpdir();
const errors = [];
const log = (...a) => console.log("•", ...a);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[console] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) errors.push(`[5xx] ${r.status()} ${r.url()}`); });

  // 1) Configuración inicial
  await page.goto(BASE);
  await page.getByText("Configuración inicial").waitFor();
  await page.getByLabel("Nombre").fill("Laura Gómez");
  await page.getByLabel("Correo electrónico").fill("admin@autoreca.local");
  await page.getByLabel("Contraseña", { exact: true }).fill("ClaveSegura123");
  await page.getByLabel("Repita la contraseña").fill("ClaveSegura123");
  await page.getByRole("button", { name: "Crear administrador" }).click();
  await page.getByText("Buenos días").or(page.getByText("Buenas tardes")).or(page.getByText("Buenas noches")).first().waitFor();
  log("setup + login OK");
  await page.screenshot({ path: `${SHOTS}/01-dashboard-vacio.png` });

  // 2) Datos de prueba vía API (con la sesión del navegador)
  const H = { "X-Requested-With": "autoreca" };
  const post = async (u, data) => { const r = await page.request.post(BASE + "/api" + u, { headers: H, data }); if (!r.ok()) throw new Error(u + " " + r.status() + " " + await r.text()); return r.json(); };
  const sup = await post("/suppliers", { name: "Distribuidor Pruebas", type: "distribuidor", phone: "600 000 000", email: "ventas@prueba.local", location: "Madrid" });
  const cat = await post("/suppliers", { name: "CAT Pruebas Sevilla", type: "cat", phone: "955 000 000", location: "Sevilla" });
  const mk = (name, kind, supplier, verified) => post("/integrations/sources", { name, data_kind: kind, supplier_id: supplier, verified_source: verified });
  const sOem = await mk("Catálogo OEM (prueba)", "oem", null, true);
  const sIam = await mk("Equivalencias (prueba)", "iam", null, false);
  const sNew = await mk("Tarifa Distribuidor Pruebas", "offers_new", sup.id, false);
  const sUsed = await mk("Stock CAT Pruebas Sevilla", "offers_used", cat.id, false);
  const imp = async (src, name, csv) => {
    const r = await page.request.post(`${BASE}/api/integrations/sources/${src.id}/import`, { headers: H, multipart: { file: { name, mimeType: "text/csv", buffer: Buffer.from(csv) }, mode: "reemplazar" } });
    return (await r.json()).ok;
  };
  log("import", await imp(sOem, "oem.csv", F.OEM_CSV), await imp(sIam, "iam.csv", F.IAM_CSV), await imp(sNew, "new.csv", F.NEW_CSV), await imp(sUsed, "used.csv", F.USED_CSV));
  await post("/customers", { name: "Taller Mecánico Pruebas", phone: "611 111 111", email: "taller@prueba.local" });

  // 3) Buscador: VIN + alternador
  await page.getByRole("link", { name: "Buscador inteligente" }).click();
  await page.getByLabel("Matrícula o bastidor").fill("WVWZZZ1KZ6W000001");
  await page.getByText("VIN", { exact: true }).waitFor();
  await page.getByLabel("Pieza").fill("alternador");
  await page.screenshot({ path: `${SHOTS}/02-buscador.png` });
  await page.getByRole("button", { name: "BUSCAR RECAMBIO" }).click();
  await page.getByText("Se necesita una aclaración").waitFor();
  log("clarification shown");
  await page.screenshot({ path: `${SHOTS}/03-aclaracion.png`, fullPage: true });
  // Completar datos con el formulario rápido
  const clar = page.locator(".card", { hasText: "Se necesita una aclaración" });
  await clar.getByLabel("Modelo", { exact: true }).fill("Golf");
  await clar.getByLabel("Año", { exact: true }).fill("2006");
  await clar.getByLabel("Código de motor", { exact: true }).fill("BXE");
  await clar.getByLabel("Combustible", { exact: true }).selectOption("Diésel");
  await clar.getByRole("button", { name: /Completar datos/ }).click();
  await page.getByText("ORIGINAL OEM").waitFor();
  await page.waitForTimeout(400);
  const counts = await page.locator(".col-head .badge").allInnerTexts();
  log("columns A/B/C:", counts.join(" | "));
  await page.screenshot({ path: `${SHOTS}/04-resultados.png`, fullPage: true });
  await page.screenshot({ path: `${SHOTS}/04b-resultados-viewport.png` });

  // Filtros
  await page.getByLabel("Ordenar").selectOption("precio_asc");
  await page.locator("label.check", { hasText: "No compatible" }).locator("input").check();
  const afterNC = await page.locator(".col-head .badge").allInnerTexts();
  log("with no compatibles:", afterNC.join(" | "));
  await page.locator("label.check", { hasText: "Solo con stock" }).locator("input").check();
  log("only stock:", (await page.locator(".col-head .badge").allInnerTexts()).join(" | "));
  await page.getByRole("button", { name: "Restablecer filtros" }).click();
  // Detalles
  await page.locator(".rcard").first().getByRole("button", { name: "Detalles" }).click();
  await page.locator(".compat-detail").first().waitFor();
  // Pasos
  await page.locator(".step").nth(2).click();
  await page.getByRole("dialog").getByText("Fuente").first().waitFor();
  await page.screenshot({ path: `${SHOTS}/05-paso-fuentes.png` });
  await page.getByRole("dialog").getByLabel("Cerrar").click();
  // Comparar
  const cmpBtns = page.locator(".rcard").getByRole("button", { name: "Comparar" });
  await cmpBtns.nth(0).click(); await cmpBtns.nth(1).click(); await cmpBtns.nth(2).click();
  await page.getByRole("button", { name: "Comparar", exact: true }).last().click();
  await page.getByText("Comparar referencias").waitFor();
  await page.screenshot({ path: `${SHOTS}/06-comparar.png` });
  await page.getByRole("dialog").getByLabel("Cerrar").click();
  await page.getByRole("button", { name: "Vaciar" }).click();
  // Guardar
  await page.locator(".rcard").first().getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Resultado guardado").waitFor();
  // Consultar proveedor (menú)
  const withSup = page.locator(".rcard", { hasText: "Distribuidor Pruebas" }).first();
  await withSup.getByRole("button", { name: "Consultar proveedor" }).click();
  await withSup.getByText("Llamar 600 000 000").waitFor();
  log("supplier contact OK");
  // Añadir a presupuesto
  const confirmed = page.locator(".rcard", { hasText: "MarcaPruebaA" }).first();
  await confirmed.getByRole("button", { name: "Presupuesto" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Añadir" }).click();
  await page.waitForURL(/presupuestos\/[0-9a-f-]+/);
  await page.getByText("Totales").waitFor();
  log("quote created from search");
  await page.getByLabel("Cliente").selectOption({ label: "Taller Mecánico Pruebas" });
  await page.getByRole("button", { name: "Añadir línea" }).click();
  const lastDesc = page.getByLabel("Descripción").last();
  await lastDesc.fill("Mano de obra desmontaje");
  await page.getByLabel("Precio").last().fill("45");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.getByText("Presupuesto guardado").waitFor();
  await page.screenshot({ path: `${SHOTS}/07-presupuesto.png`, fullPage: true });
  const pdf = await page.request.get(page.url().replace("/presupuestos/", "/api/quotes/") + "/pdf");
  log("pdf", pdf.status(), pdf.headers()["content-type"]);
  require("fs").writeFileSync(`${SHOTS}/presupuesto.pdf`, await pdf.body());
  await page.getByRole("button", { name: "Aceptado" }).click();
  await page.getByText("Estado: Aceptado").waitFor();
  await page.getByRole("button", { name: "Convertir en pedido" }).click();
  await page.getByRole("button", { name: "Crear pedido" }).click();
  await page.waitForURL(/pedidos\//);
  await page.getByRole("button", { name: "Solicitado a proveedor" }).click();
  await page.getByText("Pedido actualizado").waitFor();
  log("order flow OK");
  await page.screenshot({ path: `${SHOTS}/08-pedido.png`, fullPage: true });

  // Búsqueda por matrícula desconocida
  await page.goto(BASE + "/buscador");
  await page.getByLabel("Matrícula o bastidor").fill("1234 BCD");
  await page.getByLabel("Pieza").fill("retrovisor izquierdo");
  await page.getByRole("button", { name: "BUSCAR RECAMBIO" }).click();
  await page.getByText("Matrícula 1234BCD sin identificar").waitFor();
  const c2 = page.locator(".card", { hasText: "sin identificar" });
  await c2.getByLabel("Marca", { exact: true }).fill("Volkswagen");
  await c2.getByLabel("Modelo", { exact: true }).fill("Golf");
  await c2.getByLabel("Año", { exact: true }).fill("2006");
  await c2.getByRole("button", { name: /Guardar vehículo y buscar/ }).click();
  await page.getByText("ORIGINAL OEM").waitFor();
  log("plate flow OK", (await page.locator(".col-head .badge").allInnerTexts()).join(" | "));
  await page.screenshot({ path: `${SHOTS}/09-retrovisor.png`, fullPage: true });

  // Referencia
  await page.getByRole("button", { name: "Referencia", exact: true }).click();
  await page.getByLabel("Referencia").fill("TB-555");
  await page.getByLabel("Matrícula o bastidor").fill("");
  await page.getByRole("button", { name: "BUSCAR RECAMBIO" }).click();
  await page.getByText("ORIGINAL OEM").waitFor();
  log("ref flow OK");
  // Foto sin IA
  await page.getByRole("button", { name: "Fotografía", exact: true }).click();
  await page.getByText("Búsqueda por fotografía no disponible").waitFor();

  // Inventario: alta
  await page.getByRole("link", { name: "Inventario" }).click();
  await page.getByRole("button", { name: "Registrar pieza" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Descripción", { exact: true }).fill("Alternador 140A usado revisado");
  await dlg.getByLabel("Estado", { exact: true }).selectOption("usado");
  await dlg.getByLabel("Referencia OEM", { exact: true }).fill("TEST-ALT-001");
  await dlg.getByLabel("Precio de compra (€)", { exact: true }).fill("30");
  await dlg.getByLabel("Precio de venta (€)", { exact: true }).fill("85");
  await dlg.getByLabel("Ubicación física", { exact: true }).fill("Estantería B-12");
  await dlg.getByRole("button", { name: "Registrar" }).click();
  await page.getByText("Pieza registrada").waitFor();
  await dlg.getByRole("button", { name: "Cerrar", exact: true }).last().click();
  await page.getByText("Alternador 140A usado revisado").waitFor();
  log("inventory create OK");

  // Visitar todas las secciones
  const sections = ["Dashboard", "Vehículos", "Inventario", "Referencias OEM", "Equivalencias IAM", "Recambios usados CAT", "Clientes", "Proveedores", "Presupuestos", "Pedidos", "Historial de búsquedas", "Estadísticas", "Integraciones", "Configuración"];
  let i = 10;
  for (const s of sections) {
    await page.getByRole("link", { name: s, exact: true }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(250);
    const errBox = await page.locator(".alert-red").count();
    if (errBox) errors.push(`[ui-error] ${s}: ${await page.locator(".alert-red").first().innerText()}`);
    await page.screenshot({ path: `${SHOTS}/${i++}-${s.replace(/\W+/g, "_")}.png`, fullPage: true });
  }
  log("all sections visited");
  // Detalle de vehículo y OEM
  await page.getByRole("link", { name: "Vehículos", exact: true }).click();
  await page.locator("tbody tr").first().click();
  await page.getByText("Historial de piezas consultadas").waitFor();
  await page.getByRole("link", { name: "Referencias OEM", exact: true }).click();
  await page.locator("tbody tr").first().click();
  await page.getByText("Aplicaciones por vehículo").first().waitFor();
  await page.getByRole("dialog").getByLabel("Cerrar").click();
  // Configuración: empresa
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page.getByLabel("Razón social").fill("Recambios Ejemplo S.L.");
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Datos de empresa guardados").waitFor();
  for (const t of ["Usuarios", "Sinónimos de piezas", "Mi cuenta", "Sistema y seguridad"]) { await page.getByRole("tab", { name: t }).click(); await page.waitForTimeout(250); }
  log("settings OK");

  // iPad y móvil
  for (const [name, dev] of [["ipad", "iPad Pro 11"], ["iphone", "iPhone 14"]]) {
    const c = await browser.newContext({ ...require("playwright").devices[dev], storageState: await ctx.storageState() });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(`[${name} pageerror] ${e.message}`));
    await p.goto(BASE + "/buscador");
    await p.getByLabel("Matrícula o bastidor").fill("1234BCD");
    await p.getByLabel("Pieza").fill("alternador");
    await p.getByRole("button", { name: "BUSCAR RECAMBIO" }).click();
    await p.getByText("ORIGINAL OEM").waitFor();
    await p.screenshot({ path: `${SHOTS}/30-${name}-resultados.png` });
    await p.goto(BASE + "/");
    await p.waitForLoadState("networkidle");
    await p.screenshot({ path: `${SHOTS}/31-${name}-dashboard.png` });
    if (name === "iphone") {
      await p.getByLabel("Abrir menú").click();
      await p.waitForTimeout(300);
      await p.screenshot({ path: `${SHOTS}/32-iphone-menu.png` });
      await p.getByRole("link", { name: "Presupuestos" }).click();
      await p.waitForURL(/presupuestos/);
    }
    await c.close();
  }
  log("responsive OK");
  await browser.close();
  console.log(errors.length ? "ERRORES:\n" + errors.join("\n") : "SIN ERRORES DE CONSOLA NI DE SERVIDOR");
})().catch(async (e) => { console.error("FALLO:", e.message); console.log(errors.join("\n")); process.exit(1); });
