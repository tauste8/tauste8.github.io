# Estado del proyecto — qué funciona y qué está pendiente

Este documento es una lista honesta. «Funciona» significa implementado **y probado** (pruebas automáticas de la API y recorrido completo en navegador). «Pendiente» significa que falta algo externo (licencia, contrato, credenciales) o que no se ha podido probar en el entorno de desarrollo.

## ✅ Funciona hoy

### Buscador
- Búsqueda por **matrícula o VIN + pieza**, por **referencia OEM/IAM** y por referencia escrita en el campo de pieza (se detecta sola).
- **VIN:** valida el formato (17 caracteres, sin I, O ni Q) y obtiene la marca del código WMI (ISO 3780). Si falta algún dato, solo se piden los imprescindibles.
- **Versiones posibles:** cuando hay varias en los catálogos cargados (modelo, años, códigos de motor), se ofrecen para elegir. Elegir una no la da por confirmada.
- **Matrícula:** se reconoce si el vehículo ya está registrado. Si no lo está, se piden el VIN o los datos básicos y se guarda para la próxima vez. Ver «Pendiente» más abajo.
- **Interpretación de la pieza:**
  - 60 tipos de pieza y más de 230 denominaciones.
  - Corrección de faltas de ortografía.
  - Lado (izquierdo/derecho) y eje (delantero/trasero).
  - Sinónimos propios de la empresa, editables desde Configuración.
  - Si la pieza tiene lado o eje y no se ha indicado, se pide.
- **Referencias OEM y sustituciones**, **equivalencias IAM** con precios de tarifa, **usados CAT** por referencia OEM o por vehículo donante, e **inventario propio**.
- **Compatibilidad** en tres estados, con lo que coincide, las incompatibilidades y lo que falta. Solo se confirma con fuente verificada, marca, modelo y código de motor coincidentes y año dentro del rango. Las diferencias técnicas (p. ej. amperaje) marcan la pieza como **no compatible**.
- Filtros, orden, detalles, comparador de referencias, guardar resultado, añadir al presupuesto y contacto con el proveedor (teléfono, correo, ficha web).
- **Aprendizaje:** el trabajador puede registrar la referencia OEM que consultó en el catálogo original y las búsquedas siguientes la reutilizan.
- Historial completo y recuperable.

### Gestión
- Vehículos, inventario (con fotos y permisos), referencias OEM, equivalencias IAM, usados CAT, clientes y proveedores.
- Presupuestos:
  - Desde el buscador o desde cero.
  - Margen, descuentos por línea y global, IVA.
  - PDF, duplicado y estados.
  - Conversión de un presupuesto aceptado en pedido.
- Pedidos con estados y PDF.
- Estadísticas y panel de inicio con datos reales.

### Sistema
- Inicio de sesión y configuración inicial del administrador.
- Recuperación de contraseña: por correo si hay SMTP, o con enlace generado por un administrador.
- Roles, cierre de sesiones, cambio de contraseña, bloqueo por intentos fallidos y registro de actividad.
- Credenciales cifradas, CSRF y CSP.
- Importación **CSV/Excel** con informe de errores por fila; modos «añadir» y «reemplazar».
- Exportación de copia de seguridad (JSON) y script `pg_dump` para copias programadas.
- **PWA** instalable y diseño adaptable (comprobado en escritorio, iPad Pro 11 e iPhone 14).

## ⏳ Pendiente de integración (requiere acción externa)

| Integración | Situación | Qué hace falta |
|---|---|---|
| **TecDoc (TecAlliance)** | Estructura preparada (fila de configuración, credenciales cifradas, enlace de consulta manual). **API no implementada.** | Contrato de datos con TecAlliance y su documentación técnica. Mientras tanto se pueden importar exportaciones de datos en CSV. |
| **Recambiofácil** | Igual que arriba. | Acuerdo comercial (API o envío periódico de tarifa). Las tarifas en CSV/Excel ya se pueden importar. |
| **plan.parts** | Igual que arriba. | Contrato y documentación de su API. |
| **AutoWiz** | Igual que arriba. | Contrato y documentación de su API. |
| **Matrícula → vehículo** | No hay un servicio público autorizado: la DGT no ofrece una API abierta de matrícula a bastidor. | Contratar un proveedor autorizado y desarrollar su conector con la documentación oficial. |
| **Catálogos OEM por bastidor (despiece)** | La aplicación no consulta despieces de fabricante en tiempo real. | Licencia de un catálogo electrónico (TecDoc, plan.parts…). Hasta entonces: importación de catálogos y registro manual de referencias. |

Ningún conector se simula y no se usa *scraping*. Si un conector con licencia no está implementado, la interfaz lo muestra como «No conectado» y no se puede activar.

## ⚠️ Implementado pero no verificado en este entorno

- **NHTSA vPIC** (decodificador público de VIN de EE. UU.): implementado con la API pública, pero el entorno de desarrollo no tenía salida a ese dominio, así que no se ha probado contra el servicio real. Viene **desactivado** por defecto; actívelo y pulse «Probar conexión» en Integraciones. Para vehículos europeos suele devolver solo la marca.
- **Asistente de IA (Claude):** implementado con salida estructurada. Solo puede elegir tipos de pieza del diccionario y nunca genera referencias, precios ni compatibilidades. No se ha probado con una clave real. Se activa con `ANTHROPIC_API_KEY`. Sin clave, la búsqueda por foto se muestra como no disponible y el resto funciona igual.
- **Envío de correo (SMTP):** implementado con nodemailer, sin probar contra un servidor real.
- **Imagen Docker y Render:** `Dockerfile`, `docker-compose.yml` y `render.yaml` incluidos, pero no se pudieron construir aquí (no había Docker disponible ni acceso a la documentación de Render). Sí se han comprobado la instalación limpia, la compilación y el arranque en modo producción con solo las dependencias de producción, que es lo mismo que hace la imagen.

## Próximos pasos recomendados

1. Contratar un catálogo profesional (TecDoc u otro) e implementar su conector en `server/src/connectors/registry.ts` con la documentación oficial.
2. Pedir a los proveedores habituales sus tarifas y stocks en CSV/Excel y crear una fuente por proveedor.
3. Contratar un servicio autorizado de identificación por matrícula.
4. Importaciones programadas (por ejemplo, recoger tarifas por SFTP cada noche) cuando haya proveedores con envío periódico.
