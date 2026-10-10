# Sistema Experto POS de Ventas

React + TypeScript + CSS (frontend) · Node + Express + TypeScript (backend) · PostgreSQL.

## Correr en local
1. Crear una BD PostgreSQL vacía.
2. `cd backend && cp .env.example .env` (editar DATABASE_URL) → `npm install && npm run dev`
   (al iniciar crea las tablas y carga productos, reglas, combos, facturas y devoluciones de ejemplo).
3. `cd frontend && cp .env.example .env` → `npm install && npm run dev`

## Cómo funciona el sistema experto
- Base de conocimiento: tablas `rules`, `combos`, `products` + historial de facturas.
- Motor de inferencia: `backend/src/engine.ts` (descuentos, devoluciones, recomendación de precio y combos).
- Cada decisión guarda una traza (CÓMO / POR QUÉ) visible con los botones "¿Cómo lo hizo?" y "¿Por qué?"
  y en la pestaña "Preguntar al sistema".
- Aprende de los datos nuevos: el margen sugerido sale del promedio de la categoría y la afinidad de combos
  sale del historial de facturas; nuevas reglas se agregan desde la pestaña Reglas.

## Despliegue
Orden: Base de datos → Backend → Frontend → cerrar CORS.

1. **BD en Neon (PostgreSQL)**: crear proyecto y copiar la connection string
   (`postgresql://usuario:clave@host/basededatos?sslmode=require`).
2. **Backend en Render/Koyeb** (carpeta `backend`, usa el Dockerfile):
   - `DATABASE_URL` = connection string de Neon.
   - `FRONTEND_URL` = URL de Vercel **sin "/" final** (se puede cerrar después).
   - `PORT` lo inyecta la plataforma (el código ya lee `process.env.PORT`).
3. **Frontend en Vercel** (carpeta `frontend`, framework Vite):
   - `VITE_API_URL` = URL pública del backend **sin "/" final** (se compila en el build).
4. **Cerrar CORS**: poner el `FRONTEND_URL` real en el backend y redesplegarlo.

> Las variables de entorno se configuran en el panel de cada plataforma, NO en el repo.
> Los `.env` locales están en `.gitignore`; solo se versionan los `.env.example`.
