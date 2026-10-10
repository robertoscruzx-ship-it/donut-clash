# 🍩 Donut Royale

Sitio de "casino" con moneda virtual (**donuts**, sin valor monetario real) que se integra
con un bot de Minecraft para vincular cuentas y depositar saldo.

> ⚠️ **Aviso importante:** este proyecto usa una moneda **virtual interna del servidor**,
> no dinero real. Antes de operar algo así de cara al público debes:
> - Confirmar que tu servidor de Minecraft y tu jurisdicción permiten juegos de azar
>   con moneda virtual (las reglas cambian mucho según el país y según si los "donuts"
>   se pueden canjear por dinero real o por objetos con valor de reventa).
> - Restringir el acceso a menores de edad si tu comunidad los incluye.
> - Implementar la lógica de apuestas (Mines/Crash/Coinflip) **en el backend**, nunca
>   confiando en el cliente, y guardar un registro auditable de cada apuesta.
> Este README no sustituye asesoría legal.

---

## 1. Estructura del proyecto

```
donut-clash/
├── frontend/              # HTML/CSS/JS vanilla — se despliega en GitHub Pages
│   ├── index.html
│   ├── style.css
│   └── script.js
├── api/                   # Backend Express como Vercel Serverless Functions
│   ├── package.json
│   ├── lib/
│   │   ├── db.js          # Conexión a MongoDB Atlas
│   │   ├── auth.js        # Middleware de api_key
│   │   └── cors.js        # Middleware CORS
│   └── api/
│       ├── generate-code.js
│       ├── verify-link.js
│       ├── deposit-donuts.js
│       └── user/
│           └── [username].js
├── vercel.json
└── README.md
```

Este repo soporta **dos formas de desplegar**:

- **Recomendada:** frontend en GitHub Pages + backend como proyecto Vercel aparte
  (Root Directory = `api`). Es la que describen los pasos de abajo.
- **Alternativa:** todo en un único proyecto Vercel, usando el `vercel.json` de la raíz
  (que ya redirige `/api/*` al backend y el resto a `frontend/index.html`).

---

## 2. Crear la base de datos en MongoDB Atlas (gratis)

1. Entra en https://www.mongodb.com/cloud/atlas/register y crea una cuenta.
2. Al crear tu primer clúster, elige el plan **M0 Free** (gratis para siempre).
3. Elige un proveedor/región cualquiera y crea el clúster (tarda 1-3 minutos).
4. En **Database Access**, crea un usuario de base de datos con usuario y contraseña
   (guárdalos, los necesitarás para la URI).
5. En **Network Access**, añade la IP `0.0.0.0/0` (permitir acceso desde cualquier IP),
   necesario porque Vercel usa IPs dinámicas.
6. En **Database → Connect → Drivers**, copia la cadena de conexión, similar a:
   ```
   mongodb+srv://<usuario>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
7. Sustituye `<usuario>` y `<password>` por tus credenciales reales. Esta cadena completa
   es tu `MONGODB_URI`.

---

## 3. Subir el código a GitHub

1. Crea un repositorio nuevo en https://github.com/new (puede ser público o privado).
2. Desde tu carpeta local del proyecto:
   ```bash
   cd donut-clash
   git init
   git add .
   git commit -m "Initial commit: Donut Clash"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/donut-clash.git
   git push -u origin main
   ```

---

## 4. Generar una API_KEY segura

Necesitas un valor secreto largo y aleatorio que compartirán tu backend y tu bot de
Minecraft (nunca el frontend público). Genera uno con cualquiera de estos métodos:

- En terminal (Linux/Mac): `openssl rand -hex 32`
- En Node.js: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- O usa un generador de contraseñas online de al menos 40 caracteres.

Guarda ese valor: lo usarás como `API_KEY` en Vercel y en la configuración de tu bot
de Minecraft (solo el bot y el backend deben conocerlo; nunca lo pongas en el frontend).

---

## 5. Desplegar el backend en Vercel

1. Entra en https://vercel.com y crea una cuenta (puedes usar tu cuenta de GitHub).
2. Haz clic en **Add New → Project** e importa tu repositorio `donut-clash`.
3. En **Root Directory**, selecciona la carpeta `api` (así Vercel solo construye el backend).
4. En **Environment Variables**, añade:
   | Nombre         | Valor                                              |
   |----------------|-----------------------------------------------------|
   | `MONGODB_URI`  | La cadena de conexión que copiaste de Atlas          |
   | `API_KEY`      | El valor secreto que generaste en el paso 4          |
5. Haz clic en **Deploy**. Al terminar, Vercel te dará una URL como:
   ```
   https://donut-clash-api.vercel.app
   ```
6. Prueba que funciona visitando (en el navegador o con `curl`):
   ```
   https://donut-clash-api.vercel.app/api/user/steve
   ```
   Debería devolver `{"error":"Usuario no encontrado."}` (eso confirma que la API y la
   base de datos responden correctamente).

---

## 6. Configurar el frontend con la URL del backend

Abre `frontend/script.js` y cambia esta línea con tu URL real de Vercel:

```js
const API_BASE_URL = "https://donut-clash-api.vercel.app/api";
```

Vuelve a subir el cambio a GitHub:
```bash
git add frontend/script.js
git commit -m "Configurar API_BASE_URL"
git push
```

---

## 7. Habilitar GitHub Pages para el frontend

1. En tu repositorio de GitHub, ve a **Settings → Pages**.
2. En **Source**, elige la rama `main` y la carpeta `/frontend` (GitHub Pages permite
   servir desde una subcarpeta si tu repo la tiene disponible en la rama; si tu cuenta
   no ofrece esa opción, usa `/ (root)` y mueve el contenido de `frontend/` a la raíz
   de una rama dedicada, ej. `gh-pages`).
3. Guarda. GitHub te dará una URL como:
   ```
   https://tu-usuario.github.io/donut-clash/
   ```
4. Visita esa URL: deberías ver la pantalla "Vincula tu cuenta de Minecraft".

---

## 8. Conectar tu bot de Minecraft a la API

Tu bot de Minecraft (el que escucha el comando `/pay`) debe llamar a estos endpoints
**incluyendo siempre `api_key` en el cuerpo de la petición**:

- **Cuando detecte un pago con `/pay Donaciones <código>`:**
  ```
  POST https://donut-clash-api.vercel.app/api/verify-link
  Body: { "minecraft_username": "Steve", "payment_amount": 437, "api_key": "TU_API_KEY" }
  ```

- **Cuando el jugador deposite donuts reales del servidor a su cuenta web:**
  ```
  POST https://donut-clash-api.vercel.app/api/deposit-donuts
  Body: { "minecraft_username": "Steve", "amount": 500, "api_key": "TU_API_KEY" }
  ```

El endpoint `generate-code` y `user/:username` no requieren `api_key` porque los llama
el frontend público directamente.

---

## 9. Modo demostrativo / educativo — margen y "pérdida forzada"

Este proyecto está pensado para usarse como material de una **charla/presentación
sobre cómo funcionan (y se pueden manipular) los juegos de azar**. La moneda "donuts"
no tiene valor real ni se canjea por dinero ni por nada de valor — se queda dentro
de la demo. Por eso el diseño de los juegos incluye dos mecanismos que **deben
revelarse a los participantes** como parte de la presentación:

1. **Margen de la casa del 20%** (`HOUSE_EDGE = 0.20` en `api/lib/houseEdge.js`),
   aplicado reduciendo el multiplicador de pago (el volado sigue siendo 50/50 real,
   las bombas de Mines están realmente distribuidas al azar, etc., salvo por el
   punto 2).
2. **Pérdida forzada**: si la ganancia máxima posible de una apuesta supera el 75%
   de la reserva actual de la casa (`MAX_EXPOSURE_FRACTION` en el mismo archivo),
   esa apuesta pierde de forma determinista (sin usar el generador aleatorio), en
   vez de rechazarse. Está en `api/lib/bankroll.js`.

**Importante:** estos dos mecanismos solo tienen sentido ético en un contexto donde
no hay valor real en juego y donde se le explica a la audiencia, al final de la
demo, exactamente cómo funcionó. Usar esto como un producto real de apuestas con
algo de valor en juego, sin decírselo a los jugadores, sería un esquema de fraude
— no lo uses así.

### Registro interno para la revelación
Cada apuesta resuelta (de los 3 juegos) queda guardada en la colección `bets`, con
`won`, `payout` y `forced_loss`. Hay un endpoint **oculto** (no enlazado desde el
frontend) pensado para que el presentador consulte los números reales al final de
la sesión:

```
POST /api/admin/stats
Body: { "api_key": "TU_API_KEY" }
```

Devuelve, por juego y en total: apuestas totales, monto apostado, monto pagado,
victorias, derrotas, cuántas fueron pérdida forzada, el margen real observado
(`observed_house_edge`) y la reserva actual de la casa. Ideal para proyectar en
pantalla como el cierre de la charla: "jugaron X rondas, apostaron Y donuts, la
casa se quedó con Z% — así es como funciona un juego con el resultado manipulado."

### Reserva de la casa
La colección `house` guarda un único documento (`_id: "main"`) con el campo
`reserve`. Se actualiza sola con cada apuesta (sube cuando alguien apuesta, baja
cuando alguien cobra un premio), pero necesita un valor inicial. Puedes insertarlo
manualmente desde MongoDB Atlas (Collections → `house` → Insert Document):
```json
{ "_id": "main", "reserve": 1000 }
```

---

## 10. Próximos pasos recomendados

- Endpoints de apuestas reales (`POST /api/bet/mines`, `/bet/crash`, `/bet/coinflip`)
  que resuelvan el resultado en el servidor y descuenten/aumenten el saldo en MongoDB
  de forma atómica. **(Ya implementado, ver sección 9 arriba.)**
- Un sistema "provably fair" (semilla del servidor + semilla del cliente) para que los
  jugadores puedan verificar que los resultados no están manipulados.
- Límites de apuesta, límites de pérdida diaria y opción de autoexclusión.
- Registro (logs) de cada transacción para auditoría.
- Cambiar el `Access-Control-Allow-Origin: *` de `api/lib/cors.js` por el dominio exacto
  de tu GitHub Pages, por seguridad.
