# Publicar AUTORECA IA desde un iPad (Render)

Render es un servicio de alojamiento que se maneja desde el navegador. Lee el archivo `render.yaml` del repositorio y crea automáticamente:

- **autoreca-db**: la base de datos PostgreSQL.
- **autoreca-ia**: la aplicación, con dirección `https://…onrender.com` y HTTPS incluido.

Tiempo aproximado: 15 minutos, la mayoría esperando a que se construya.

## Antes de empezar

- Su cuenta de GitHub (`tauste8`).
- Una tarjeta para el pago mensual. Con los planes del archivo (`starter` para la aplicación y `basic-256mb` para la base de datos) el coste es de unos **15 USD al mes**. **Compruebe el precio exacto que muestra Render antes de confirmar.**

## Pasos

1. **Cree la cuenta.** En Safari, abra **https://render.com** → **Get Started** → **GitHub**. Autorice el acceso con su cuenta de GitHub.
2. **Dé acceso al repositorio.** Si Render pregunta a qué repositorios puede acceder, elija **Only select repositories** → `tauste8.github.io` → **Install**.
3. **Cree el Blueprint.** En el panel de Render pulse **New +** → **Blueprint** y elija el repositorio `tauste8.github.io`.
   - Render mostrará los dos recursos que va a crear: `autoreca-ia` y `autoreca-db`.
   - Si pide un nombre para el Blueprint, escriba `autoreca`.
   - Si pide un valor para **ANTHROPIC_API_KEY**, déjelo **vacío**. Es opcional y sirve para la búsqueda por foto; se puede añadir más tarde.
4. **Confirme.** Pulse **Apply** (o **Deploy Blueprint**). Si pide la tarjeta, añádala.
5. **Espere a la construcción.** Abra el servicio **autoreca-ia**. La primera vez tarda entre 5 y 10 minutos; cuando termine verá el estado **Live**.
6. **Abra la aplicación.** La dirección aparece arriba, en el servicio (algo como `https://autoreca-ia.onrender.com`). Ábrala y cree la **cuenta de administrador**.
7. **Instálela como app en el iPad.** En Safari: botón **Compartir** → **Añadir a pantalla de inicio** → **Añadir**.

## Si algo falla

- **El Blueprint da un error de validación** (por ejemplo, un nombre de plan no válido): copie el mensaje y envíelo. Mientras tanto puede usar el plan B.
- **La construcción falla:** en el servicio **autoreca-ia** → **Logs**, copie las últimas líneas en rojo y envíelas.

### Plan B: crearlo a mano (sin Blueprint)

1. **New +** → **PostgreSQL** → nombre `autoreca-db` → elija un plan → **Create Database**. Cuando esté lista, copie la **Internal Database URL**.
2. **New +** → **Web Service** → repositorio `tauste8.github.io`.
   - Render detectará el `Dockerfile` (lenguaje **Docker**).
   - Plan: **Starter**.
3. En **Environment Variables** añada:
   - `DATABASE_URL` = la Internal Database URL del paso 1
   - `APP_ENCRYPTION_KEY` = 64 caracteres aleatorios (pulse **Generate** si aparece la opción)
   - `NODE_ENV` = `production`
   - `TRUST_PROXY` = `1`
4. En **Advanced** → **Health Check Path** escriba `/api/health`. Después pulse **Create Web Service**.

## Después de publicarla

- **Actualizaciones:** cada vez que se suban cambios a la rama del repositorio, Render vuelve a desplegar automáticamente.
- **Clave de cifrado:** no cambie ni borre `APP_ENCRYPTION_KEY`. Si se pierde, habrá que volver a introducir las credenciales de las integraciones.
- **Dominio propio** (opcional): en el servicio → **Settings** → **Custom Domains** (por ejemplo `recambios.suempresa.es`). Añada también la variable `PUBLIC_URL` con esa dirección.
- **Asistente de IA** (opcional): en el servicio → **Environment** → `ANTHROPIC_API_KEY` = su clave de https://console.anthropic.com.
- **Copias de seguridad:** revise las opciones de copia de la base de datos en el panel de Render. Además, desde la aplicación: Configuración → Sistema y seguridad → «Descargar copia ahora».
- **Planes gratuitos:** no se recomiendan para uso real. Los servicios gratuitos se duermen cuando no se usan y las bases de datos gratuitas tienen caducidad; compruebe las condiciones actuales en Render.
