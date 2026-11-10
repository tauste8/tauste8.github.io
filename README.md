# AUTORECA IA

Plataforma web para localizar y gestionar recambios de automóvil, nuevos y usados.

El trabajador escribe **matrícula o bastidor** y **la pieza** («alternador») y pulsa **BUSCAR RECAMBIO**. AUTORECA IA identifica el vehículo, interpreta la pieza y localiza la referencia **OEM**. Después busca **equivalencias IAM** con precio de proveedor y **piezas usadas** en centros CAT, desguaces e inventario propio. Todo aparece en una sola pantalla y cada resultado indica su **compatibilidad**, su **fuente** y su **fecha de actualización**.

> **Principio de diseño:** la aplicación nunca inventa referencias, precios, existencias ni compatibilidades. Solo muestra lo que existe en las fuentes conectadas, dice de dónde procede cada dato y qué falta para confirmarlo.

![Resultados del buscador](docs/capturas/buscador-resultados.png)
*(Las capturas usan datos **ficticios** de prueba, p. ej. «MarcaPruebaA» o «TEST-ALT-001».)*

---

## Contenido

- [Funcionalidades](#funcionalidades)
- [Arquitectura](#arquitectura)
- [Puesta en marcha (desarrollo)](#puesta-en-marcha-desarrollo)
- [Despliegue en producción](#despliegue-en-producción)
- [Primeros pasos tras instalar](#primeros-pasos-tras-instalar)
- [Formato de los archivos de importación](#formato-de-los-archivos-de-importación)
- [Pruebas](#pruebas)
- [Estado real: qué funciona y qué está pendiente](docs/ESTADO.md)

---

## Funcionalidades

| Módulo | Qué hace |
|---|---|
| **Buscador inteligente** | Búsqueda por matrícula/VIN + pieza, por referencia OEM/IAM o por fotografía (con IA). El proceso tiene 6 pasos y se puede ver qué fuentes se consultaron en cada uno. Hay filtros por compatibilidad, precio, fabricante, proveedor, estado, stock y ubicación, y se puede ordenar por relevancia, precio o disponibilidad. Cada resultado permite ver detalles, comparar referencias, añadir al presupuesto, guardar y consultar al proveedor (teléfono, correo o web). |
| **Validación de compatibilidad** | Compara marca, modelo, generación, año, código de motor, combustible, potencia, transmisión, lado/eje de montaje y características técnicas (amperaje, dientes, conector…). Asigna uno de tres estados: **confirmada** (solo con evidencia de una fuente verificada), **pendiente** (con la lista de datos que faltan) o **no compatible** (con el motivo). |
| **Vehículos** | Ficha técnica, nivel de identificación (parcial/confirmada) e historial de piezas consultadas. |
| **Inventario** | Alta, edición y baja (solo administrador), precios de compra y venta, cantidades, ubicación, proveedor, características técnicas, fotografías y vehículo donante. Se consulta automáticamente en cada búsqueda. |
| **Referencias OEM / Equivalencias IAM / Usados CAT** | Consulta, alta manual con aplicaciones por vehículo, sustituciones (supersesión) y verificación. |
| **Clientes y proveedores** | CRM con historial de consultas, presupuestos, pedidos, condiciones comerciales, compras y estado de integración. |
| **Presupuestos y pedidos** | Líneas creadas desde el buscador, margen sobre coste, descuentos por línea y global, IVA, PDF profesional, estados y conversión a pedido. |
| **Historial y estadísticas** | Recupera búsquedas pasadas y muestra piezas, vehículos y referencias más consultados, porcentaje con resultado, tiempo medio, proveedores, ventas y presupuestos. |
| **Integraciones** | Conectores independientes con estado, prueba de conexión, registro de eventos, credenciales cifradas e importación CSV/Excel. |
| **Configuración** | Datos de la empresa (para el PDF), usuarios y roles, sinónimos propios de piezas, sesiones abiertas, cambio de contraseña, copia de seguridad y registro de actividad. |

**PWA:** se puede instalar desde Safari («Compartir → Añadir a pantalla de inicio») y desde Chrome o Edge. Está adaptada a ordenador, iPad y móvil.

<p>
<img src="docs/capturas/ipad.png" width="420" alt="iPad"> <img src="docs/capturas/iphone.png" width="200" alt="iPhone">
</p>

## Arquitectura

```
┌──────────────────────────┐      HTTPS / cookie de sesión       ┌──────────────────────────────┐
│  web/  React + TypeScript │ ──────────────────────────────────▶ │ server/  Node.js + Express    │
│  Vite · PWA · TanStack    │ ◀────────────── JSON ────────────── │ API REST · Zod · pdfkit       │
└──────────────────────────┘                                      │                              │
                                                                  │  services/search.ts  ◀── orquestación de los 6 pasos
                                                                  │  services/compatibility.ts ◀ motor de compatibilidad
                                                                  │  services/part-interpreter ◀ diccionario + sinónimos
                                                                  │  services/ai.ts (opcional, Claude)
                                                                  │  connectors/registry.ts ◀── conectores independientes
                                                                  └──────────────┬───────────────┘
                                                                                 │
                                                                     PostgreSQL 16 (datos centralizados)
```

- **Datos centralizados en PostgreSQL.** Nada de negocio se guarda en el navegador. El *service worker* solo guarda en caché la interfaz; la API va siempre a la red.
- **Seguridad:**
  - Contraseñas con bcrypt y sesiones en base de datos con cookie `HttpOnly`/`SameSite`; el token se guarda como hash.
  - Bloqueo temporal tras 5 intentos fallidos y limitación de peticiones en el inicio de sesión.
  - Protección CSRF por cabecera y cabeceras de seguridad con Helmet (CSP).
  - Roles **administrador** y **trabajador**.
  - Credenciales de integraciones cifradas con AES-256-GCM; nunca se devuelven a la interfaz.
  - Validación de todas las entradas con Zod y comprobación de la firma de las imágenes subidas.
  - Registro de actividad de cada acción.
- **Conectores** (`server/src/connectors/registry.ts`): cada proveedor es un objeto que declara qué datos aporta, qué necesita y, si tiene API, sus funciones. Para añadir uno no hay que tocar el buscador.

## Puesta en marcha (desarrollo)

Requisitos: **Node.js 20+** y **PostgreSQL 14+**.

```bash
npm install
createdb autoreca                       # o cree la base de datos como prefiera
cp .env.example .env                    # opcional en desarrollo

# Terminal 1 — API (aplica las migraciones al arrancar) en http://localhost:3000
DATABASE_URL=postgres://usuario:clave@localhost:5432/autoreca npm run dev:server

# Terminal 2 — interfaz con recarga en caliente en http://localhost:5173
npm run dev:web
```

La primera vez que abra la aplicación le pedirá crear la cuenta de **administrador**.

## Despliegue en producción

> **No puede ejecutarse en GitHub Pages.** GitHub Pages solo sirve archivos estáticos, y AUTORECA IA necesita un servidor Node.js y una base de datos PostgreSQL. Despliéguela en un servidor propio, un VPS o un servicio con contenedores.

### Opción A — Docker Compose (recomendada)

```bash
cp .env.example .env
# Edite .env: POSTGRES_PASSWORD, APP_ENCRYPTION_KEY (openssl rand -hex 32), PUBLIC_URL…
docker compose up -d --build
```

La aplicación queda en el puerto 3000. Póngala detrás de un proxy inverso con HTTPS (Caddy, Nginx o Traefik) y defina `TRUST_PROXY=1`. HTTPS es **obligatorio** para la cookie segura y para instalar la PWA.

Ejemplo mínimo con Caddy:

```
recambios.su-dominio.es {
  reverse_proxy localhost:3000
}
```

### Opción B — Node.js directamente

```bash
npm ci && npm run build
cd server
NODE_ENV=production DATABASE_URL=… APP_ENCRYPTION_KEY=… PUBLIC_URL=… node dist/index.js
```

### Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena de conexión de PostgreSQL |
| `APP_ENCRYPTION_KEY` | Sí (producción) | Clave para cifrar credenciales de integraciones. **Guárdela**: si se pierde, habrá que volver a introducir las credenciales |
| `PUBLIC_URL` | Recomendada | URL pública, usada en los enlaces de recuperación de contraseña |
| `TRUST_PROXY` | Si hay proxy | `1` detrás de un proxy inverso |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | No | Correo para recuperar la contraseña. Sin SMTP, un administrador genera el enlace desde Configuración → Usuarios |
| `ANTHROPIC_API_KEY` | No | Activa el asistente de IA (interpretación de denominaciones y búsqueda por foto) |
| `AI_MODEL` | No | Modelo de Claude (por defecto `claude-opus-5-5`) |
| `UPLOADS_DIR` | No | Carpeta de fotografías (por defecto `./data/uploads`) |
| `SESSION_DAYS`, `PORT` | No | Duración de la sesión (7 días) y puerto (3000) |

### Copias de seguridad

- **Automáticas:** `scripts/backup.sh` hace `pg_dump` de la base de datos y un archivo de las fotografías, y conserva 30 días. Prográmelo con `cron`; dentro del script están las instrucciones y el comando de restauración.
- **Manual:** en Configuración → Sistema y seguridad → «Descargar copia ahora» (JSON sin contraseñas ni credenciales).

## Primeros pasos tras instalar

1. **Configuración → Empresa:** razón social, CIF, IVA y margen por defecto (aparecen en el PDF).
2. **Configuración → Usuarios:** dé de alta al equipo (rol trabajador o administrador).
3. **Proveedores:** registre distribuidores, centros CAT y desguaces.
4. **Integraciones → Nueva fuente de archivo:** cree una fuente por cada tarifa o listado de stock que le envíen sus proveedores e importe el CSV o Excel. Puede descargar las plantillas desde la misma pantalla.
5. **Inventario:** registre las piezas que tiene en almacén.
6. Cuando una búsqueda no encuentre la referencia OEM, use **«Registrar referencia OEM consultada»**. Queda guardada para ese modelo y código de motor, y las búsquedas siguientes la encontrarán solas.

## Formato de los archivos de importación

CSV (separado por `;` o `,`, UTF-8 o Latin-1) o Excel `.xlsx`, con los nombres de columna en la primera fila. Las plantillas se descargan en **Integraciones**.

| Tipo de fuente | Columnas obligatorias | Columnas habituales |
|---|---|---|
| Catálogo OEM | `referencia_oem`, `marca_vehiculo`, `descripcion` | `tipo_pieza`, `sustituida_por`, `modelo`, `generacion`, `anio_desde`, `anio_hasta`, `codigos_motor` (separados por `\|`), `combustible`, `kw_desde`, `kw_hasta`, `transmision`, `posicion`, `verificada` |
| Equivalencias IAM | `referencia_oem`, `marca_iam`, `referencia_iam` | `descripcion`, `verificada`, `notas` |
| Recambio nuevo | `descripcion` + (`referencia` o `referencia_oem` o tipo reconocible) | `marca`, `precio`, `stock`, `disponibilidad`, `ubicacion`, `url_imagen`, `url`, `fecha_actualizacion` |
| Recambio usado | `descripcion` | `referencia_oem`, `precio`, `vehiculo_marca`, `vehiculo_modelo`, `vehiculo_anio`, `vehiculo_codigo_motor`, `bastidor_donante`, `ubicacion` |

Las columnas `spec_*` (`spec_amperaje`, `spec_dientes`, `spec_conector`…) guardan características técnicas que el motor de compatibilidad compara. Las filas con errores se rechazan una a una y se informa del número de fila.

**Fuente verificada:** marque una fuente como verificada solo si procede de un catálogo técnico oficial. Únicamente las fuentes verificadas permiten la etiqueta «Compatibilidad confirmada».

## Pruebas

```bash
# API: 40 pruebas de integración contra una base de datos de pruebas (se vacía en cada ejecución)
createdb autoreca_test
TEST_DATABASE_URL=postgres://usuario:clave@localhost:5432/autoreca_test npm test

# Interfaz: recorrido completo con Playwright (servidor apuntando a una BD de pruebas vacía)
BASE_URL=http://localhost:3200 node e2e/recorrido.cjs
```

Las pruebas usan **datos ficticios** (`server/test/api.test.ts`, `e2e/fixtures-prueba.cjs`) que nunca se cargan en la aplicación real.

## Estructura

```
server/   API Node.js (TypeScript)
  src/routes/        endpoints REST
  src/services/      buscador, compatibilidad, intérprete de piezas, importador, IA
  src/connectors/    sistema de conectores
  src/db/migrations  esquema SQL
  test/              pruebas de integración
web/      interfaz React (TypeScript), PWA
e2e/      recorrido automatizado de la interfaz
docs/     estado del proyecto y capturas
scripts/  copias de seguridad
```

Consulte **[docs/ESTADO.md](docs/ESTADO.md)** para ver qué funciona hoy y qué depende de licencias o credenciales externas.
