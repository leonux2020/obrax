# Obrax

PWA (React + Vite + Tailwind) para cubicación y presupuestos de obra. Tema OLED (negro puro, texto blanco, acentos verdes), instalable y 100 % funcional sin conexión.

## Funciones

- **Selector de país compacto y con búsqueda** (combobox accesible, una sola línea): 53 países de América y Europa con bandera, moneda (código y símbolo), **IVA / impuesto oficial** y cadenas de referencia (Chile: Sodimac, Easy, Construmart; España: Leroy Merlin, Bricomart; México: Home Depot…). Busca por país (ES/EN), código, moneda o tienda. Datos en `src/lib/regions.js`.
- **Impuesto por país en todos los resúmenes**: Chile 19 %, España 21 %, México 16 %, Argentina 21 %, Colombia 19 %… En EE. UU., Canadá y Brasil (sin tasa nacional única) la tasa es configurable (EE. UU. 8 % por defecto).
- **Dos modos de trabajo**: *Faena rápida* (1 tarea → presupuesto en ~2 min) y *Proyecto acumulado* (obra con nombre, varias partidas y **una sola lista de compra consolidada**: p. ej. los sacos de cemento del radier y de la albañilería se suman antes de redondear).
- **Seis módulos de cubicación**: radieres y losas, albañilería, tabiquería drywall, techumbres (factor de pendiente, costaneras, cubierta, caballetes, aislación, canaletas), pisos (cajas completas, adhesivo, fragüe) y pinturas (manos, galones/tinetas, imprimante, empaste).
- **Formatos comerciales indivisibles**: la necesidad geométrica se convierte en unidades de venta enteras (paños de malla, rollos, planchas, perfiles de 2,40 m, sacos, cajas, bolsones, galones y tinetas), siempre hacia arriba, con sobrante reutilizable y su valor (`src/lib/catalog.js`, `src/lib/pricing.js`).
- Motor de precios simulados por cadena con corrección manual por ítem.
- **Dos PDF independientes**: *PDF Cliente* (A4 blanco corporativo: cabecera de empresa con RUT/CIF/RFC según país, partidas, subtotal neto, impuesto oficial, total, validez y firmas; **sin tiendas, sin precios unitarios y sin sobrantes**) y *PDF Técnico* (métricas, plan de compra en unidades comerciales, compras por tienda, mermas, **Inventario de Sobrantes Reutilizables** y estructura de costos interna). Se generan con jsPDF, cargado bajo demanda (`src/lib/pdf.js`, modelos puros en `src/lib/reports.js`).
- **Evidencia visual en terreno** (máx. 4 fotos por proyecto: panorámica, estructura existente, encuentros/detalles, logística/acceso): cámara (`capture="environment"`) o galería, compresión en el dispositivo a máx. 1200 px y ≈150 KB (JPEG), guardado local en IndexedDB y galería OLED con reemplazo y borrado rápido. Van en una cuadrícula 2×2 del PDF Técnico y, opcionalmente, del PDF Cliente (`src/lib/photos.js`, `src/lib/photoStore.js`).
- Contrapiso nivelante opcional en pisos: su cemento y arena se suman a los del radier y la albañilería en una sola línea de compra.
- Configuración de empresa/profesional guardada solo en el dispositivo.
- **Perfil local sin fricción**: entras directo (nombre opcional, todo queda en el dispositivo). El botón de Google solo aparece si defines `VITE_GOOGLE_CLIENT_ID`.

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
