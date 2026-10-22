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
- **Evidencia visual en terreno** (máx. 4 fotos por proyecto: panorámica, estructura existente, encuentros/detalles, logística/acceso). Doble canal de cámara: en móvil `<input capture="environment">`; en escritorio, «Tomar foto» abre una cámara en vivo dentro de la app (`getUserMedia`, botón «Disparar») y, si no existe o se deniega el permiso, vuelve limpiamente a «Subir archivo». Ambos caminos usan el mismo compresor de canvas: espera `img.decode()`, dimensiones proporcionales exactas (máx. 1200 px), `canvas.width/height` explícitos, reducción escalonada con `imageSmoothingQuality='high'` y JPEG 0,82 (≈100–160 KB). Guardado local en IndexedDB; cuadrícula 2×2 en el PDF Técnico y, opcionalmente, en el PDF Cliente (`src/lib/photos.js`, `src/components/CameraModal.jsx`, `src/lib/photoStore.js`).
- **Motor multiidioma ligado al país** (ES, EN, PT, FR, IT, DE): Brasil/Portugal → PT; Francia/Bélgica → FR; Italia → IT; Alemania/Austria → DE; España y Latinoamérica hispana → ES; EE. UU., Canadá, Reino Unido y el resto de Europa → EN. El selector de idioma del encabezado permite cambiarlo manualmente. Traduce toda la interfaz, partidas, unidades, cabeceras de empresa, títulos y nombres de archivo de los PDF, y los formatos de número/fecha (`src/lib/dict*.js`, `src/lib/i18n.jsx`).
- Contrapiso nivelante opcional en pisos: su cemento y arena se suman a los del radier y la albañilería en una sola línea de compra.
- **Panel multiproyecto** (Fase 1): la vista principal es un gestor de proyectos con una tarjeta limpia por obra de cliente (nombre, cliente, plazo, total, empresa emisora). Cada proyecto guarda su propio borrador y sus 4 fotos (IndexedDB `obrax` v2: `projects`, `project_photos`, `company`). Los datos de la versión de proyecto único se migran solos al primer proyecto (`src/lib/projects.js`, `projectStore.js`, `src/components/Dashboard.jsx`).
- **Semáforo de tiempos** por tarjeta, según «Fecha de inicio» y «Fecha de término estimada»: verde = a tiempo, naranja = faltan ≤ 3 días o ≤ 20 % del plazo, rojo = atrasado, gris tenue = sin plazo (`trafficLight` en `src/lib/projects.js`).
- **Perfil de empresa inmutable por proyecto**: nombre, ID fiscal y logotipo se editan cuando quieras (Empresa), pero cada proyecto nuevo **copia** esos datos dentro de sí mismo; cambiar el logo en 2027 no altera los presupuestos de 2026. El logotipo (PNG/JPG/WebP) se comprime en canvas (máx. 256 px, transparencia conservada, ≤ 90 KB) y se guarda en base64 en IndexedDB (`src/lib/logo.js`, `companyStore.js`). La inyección del logo en los PDF queda para la Fase 2.
- **OLED puro y ergonomía a una mano**: todos los fondos son `#000000` (la separación es solo con bordes finos `border-white/10`; un test lo vigila) y la navegación principal (`BottomNav`), los formularios (hojas inferiores) y las acciones clave viven en el tercio inferior de la pantalla.
- **Onboarding de bienvenida**: si no hay perfil de empresa guardado, la app muestra una vista de bienvenida (logo ligero, nombre e ID fiscal) con los botones fijos abajo: «Proteger mis datos con Google Drive (Recomendado)» —por ahora solo guarda el perfil en el dispositivo; la copia en la nube llega en la Fase 4— y «Omitir por ahora» (`src/components/WelcomeOnboarding.jsx`).
- **Firma digital del cliente** (Fase 2): en el resumen no hay botón de firma: el recuadro sobre la línea «Firma / aceptación del cliente» es el disparador. Vacío muestra solo un borde `border-white/10` con el texto tenue «Doble toque para firmar»; con doble toque (`onDoubleClick` + detector de doble toque táctil + Enter/Espacio) se abre a pantalla completa un `<canvas>` táctil (dedo, lápiz o ratón, trazo suavizado) y los campos «Nombre del Cliente» e «ID:» (con «Quitar firma» si ya existe una). Al aceptar, la firma se exporta como PNG transparente de tinta negra (≤ 480×220 px, ≈ 15 KB) y se guarda en base64 con los datos del cliente dentro del proyecto (IndexedDB). Aparece en el PDF Cliente y el reporte en pantalla. Mientras existe una firma, el presupuesto conserva los precios del momento de firmar (los precios simulados cambian cada 15 min); si el total cambia por ediciones, la firma se marca como caducada y no se imprime (`src/lib/signature.js`, `SignaturePad.jsx`, `SignatureSheet.jsx`).
- **Desglose en el PDF** (Fase 2): interruptor «Mostrar desglose de Materiales y Mano de Obra en el PDF», guardado por proyecto. Añade al PDF Cliente los totales de materiales, mano de obra y transporte (suman el subtotal neto); nunca tiendas ni precios unitarios.
- **Módulo HSE** (Fase 3): un botón discreto (escudo con cruz verde) en cada partida —y en la vista de medidas del modo rápido— abre una hoja inferior con los EPP obligatorios y recomendados de esa tarea, pautas de ergonomía y cuidado postural, y una guía de sostenibilidad y disposición de residuos (economía circular). El contenido es un catálogo de ids traducido a los 6 idiomas (`src/lib/hse.js`, `src/components/HseSheet.jsx`, `src/lib/dict_p3.js`); es una guía general y no reemplaza la normativa local.
- **Cronograma y cuadrilla** (Fase 3): en «Parámetros», la tarjeta «Cronograma y cuadrilla» abre una hoja con las **horas-hombre (HH)** de trabajo activo separadas de los **tiempos técnicos muertos** (curado, fraguado, secado: 0 esfuerzo humano). Los botones grandes **+ / −** anclados abajo cambian el número de trabajadores: los días activos (en bloques de medio día, jornada de 8 h) bajan o suben al instante, mientras las HH y los días muertos no cambian; la duración total = días activos + días muertos y las partidas se ejecutan en secuencia. La cuadrilla se guarda por proyecto (`src/lib/schedule.js`, `ScheduleSheet.jsx`).
- **Maquinaria mayor** (Fase 3): el motor sugiere el arriendo de equipos pesados según las partidas (trompo hormigonero para radieres de volumen, placa compactadora para superficies grandes, andamio certificado para techos y muros/pintura sobre 3 m), calcula los días de arriendo con el cronograma y lo suma como **costo indirecto** al subtotal (repartido en la partida que lo necesita, así los capítulos siguen sumando exacto). Cada máquina se puede quitar con un interruptor y las herramientas manuales menores se omiten a propósito. Aparece en la tarjeta de maquinaria, el resumen, el desglose del PDF Cliente y el dossier técnico (con cronograma). Los proyectos antiguos ya firmados conservan su total: la maquinaria llega apagada en ellos (`src/lib/machinery.js`, `MachineryCard.jsx`).
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

- **Datos del constructor en solo lectura**: logotipo, nombre e ID del bloque de empresa y de la línea «Firma del contratista» se inyectan desde el perfil de empresa del proyecto (Onboarding / Empresa) y no tienen ninguna interacción en el resumen; el PDF usa ese logotipo (el icono de Obrax solo como respaldo).
