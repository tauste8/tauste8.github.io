# Publicar AUTORECA IA en Railway desde el iPad

Railway (https://railway.com) construye la aplicación a partir del `Dockerfile` del repositorio y aloja la base de datos PostgreSQL.

1. **Cuenta:** en Safari, abra railway.com → **Login** → **GitHub**. Si se abre la app de GitHub en vez de Safari y no le deja autorizar, desinstálela temporalmente sin perder datos: Ajustes → General → Almacenamiento del iPad → GitHub → **Desinstalar app**. Después repita.
2. **Plan:** active el plan **Hobby** (unos 5 $/mes con uso incluido; compruebe el precio en pantalla).
3. **Proyecto:** **New Project** → **Deploy from GitHub repo** → dé acceso al repositorio `tauste8.github.io` → elíjalo → **Deploy Now**. Es normal que el primer despliegue falle: aún no hay base de datos.
4. **Base de datos:** en el lienzo del proyecto → **+ Create** → **Database** → **PostgreSQL**.
5. **Variables:** pulse el servicio de la aplicación → pestaña **Variables** y añada:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `APP_ENCRYPTION_KEY` = 64 caracteres hexadecimales aleatorios
   - `NODE_ENV` = `production`
   - `TRUST_PROXY` = `1`
   - `PORT` = `3000`

   Después pulse **Deploy** / **Apply changes**.
6. **Dirección pública:** pestaña **Settings** → **Networking** → **Generate Domain** → puerto `3000`.
7. **Abrirla:** cuando el despliegue diga **Success / Active**, abra la dirección `https://….up.railway.app`, cree el administrador y añádala a la pantalla de inicio (Compartir → Añadir a pantalla de inicio).

Cada vez que se suban cambios a la rama del repositorio, Railway vuelve a desplegar automáticamente. No cambie `APP_ENCRYPTION_KEY` después de empezar a usar la aplicación.
