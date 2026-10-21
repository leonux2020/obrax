# Cubicador Pro

PWA (React + Vite + Tailwind) para cubicación y presupuestos de obra. Tema OLED (negro puro, texto blanco, acentos verdes), instalable y 100 % funcional sin conexión.

## Funciones

- Selector de país al iniciar (Chile, España, México, Colombia, Perú, EE. UU.): fija moneda, idioma y cadenas de referencia.
- Asistente paso a paso: Radier/losa, albañilería (bloques) y tabiquería drywall.
- Motor de precios simulados por cadena, con corrección manual por ítem.
- Parámetros financieros: mano de obra %, transporte %, merma %.
- Reporte doble: **Vista técnica** (obra) y **Vista comercial** (cliente), con imprimir/PDF, compartir y copiar.
- Login con Google: simulación por defecto; Google Identity Services real si defines `VITE_GOOGLE_CLIENT_ID`.

## Seguridad

- Sanitización estricta de toda entrada numérica y de texto (`src/lib/sanitize.js`), con límites duros por campo.
- CSP, HSTS, X-Frame-Options, etc. definidos en un único lugar (`security/policy.js`) y emitidos en `<meta>`, `dist/_headers` y `vercel.json`.
- Build sin source maps, minificado, sin `console`; protección anti-framing y limitador de actualizaciones (`src/lib/shield.js`).
- Límite honesto: nada en el navegador es 100 % inmune a copia. La lógica que deba ser realmente secreta debe vivir en un servidor.
- Para producción con Google: verifica el ID token **en el servidor** (firma, `aud`, `iss`, `exp`).

## Marca y PWA

El icono (casco + plano + cinta métrica) está en `src/brand/icon.js` y es la única fuente del logo, favicon, `manifest.json`, iconos PNG 192/512, maskable y apple-touch-icon. El plugin `plugins/pwa-brand.js` los genera en cada build, junto con un Service Worker versionado por hash de contenido.

## Comandos

```bash
npm install
npm run dev      # desarrollo
npm test         # pruebas
npm run build    # produce dist/
```

## Despliegue (un clic)

La carpeta `dist/` es estática y funciona en la raíz de un dominio o en un subdirectorio.

- **GitHub Pages**: sube a la rama `main`; `.github/workflows/deploy.yml` ejecuta pruebas, build y publica. Activa *Settings → Pages → Source: GitHub Actions*.
- **Vercel / Netlify**: importa el repositorio; `vercel.json` y `netlify.toml` ya están configurados.
- Opcional: define `VITE_GOOGLE_CLIENT_ID` (ver `.env.example`) como variable del entorno de build.
