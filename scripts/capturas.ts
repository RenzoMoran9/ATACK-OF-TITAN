/**
 * Capturas automáticas del juego con Playwright (Chromium + WebGL).
 *
 *   npm run capturas                     → todas las vistas
 *   npm run capturas -- tejado bosque    → solo las indicadas
 *
 * - Usa el servidor de Vite si ya está corriendo (URL_JUEGO o http://localhost:5173/);
 *   si no, levanta uno propio y lo cierra al terminar.
 * - Abre el juego con ?cam=<vista> (coloca jugador y cámara) y espera a
 *   window.__juegoListo, que el juego activa tras construir la escena y dibujar.
 * - En headless fuerza WebGL por software (--use-angle=swiftshader). Con CAPTURAS_GPU=1
 *   no se fuerza (útil en un equipo con GPU y navegador visible: CAPTURAS_VISIBLE=1).
 * - Guarda PNG en capturas/<vista>_<fecha>.png y, si hay imágenes en referencias/,
 *   una hoja comparativa capturas/comparativa_<fecha>.html.
 */
import { chromium, type Browser } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

interface Vista {
  nombre: string;
  query: string;
}

const VISTAS: Vista[] = [
  { nombre: 'tejado', query: 'cam=tejado' },
  { nombre: 'calle', query: 'cam=calle' },
  { nombre: 'muralla', query: 'cam=muralla' },
  { nombre: 'puerta', query: 'cam=puerta' },
  { nombre: 'bosque', query: 'cam=bosque' },
  { nombre: 'titan', query: 'cam=titan' },
  { nombre: 'jugador', query: 'cam=jugador' },
  { nombre: 'tejado-atardecer', query: 'cam=tejado&hora=atardecer' },
  { nombre: 'muralla-noche', query: 'cam=muralla&hora=noche' },
];

const RAIZ = path.resolve(import.meta.dirname, '..');
const DIR_CAPTURAS = path.join(RAIZ, 'capturas');
const DIR_REFERENCIAS = path.join(RAIZ, 'referencias');
const PUERTO = Number(process.env.PUERTO ?? 5173);
const ANCHO = Number(process.env.CAPTURAS_ANCHO ?? 1280);
const ALTO = Number(process.env.CAPTURAS_ALTO ?? 720);
const ESPERA_MS = Number(process.env.CAPTURAS_ESPERA ?? 180_000);

function marcaDeTiempo(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function responde(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok && (await r.text()).includes('/src/main.ts');
  } catch {
    return false;
  }
}

async function prepararServidor(): Promise<{ base: string; servidor: ViteDevServer | null }> {
  const existente = process.env.URL_JUEGO ?? `http://localhost:${PUERTO}/`;
  if (await responde(existente)) {
    console.log(`· Usando el servidor de Vite que ya está corriendo: ${existente}`);
    return { base: existente, servidor: null };
  }
  console.log('· Levantando servidor de Vite…');
  const servidor = await createServer({ root: RAIZ, logLevel: 'warn', server: { port: PUERTO, strictPort: false } });
  await servidor.listen();
  const base = servidor.resolvedUrls?.local[0] ?? `http://localhost:${PUERTO}/`;
  console.log(`· Servidor en ${base}`);
  return { base, servidor };
}

async function lanzarChromium(): Promise<Browser> {
  const visible = process.env.CAPTURAS_VISIBLE === '1';
  const args = ['--ignore-gpu-blocklist', '--enable-webgl'];
  if (process.env.CAPTURAS_GPU !== '1') args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  try {
    return await chromium.launch({ headless: !visible, args });
  } catch (e) {
    // Navegador de Playwright no descargado para esta versión: probar uno ya instalado.
    const candidatos = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter((c): c is string => !!c && fs.existsSync(c));
    for (const executablePath of candidatos) {
      console.log(`· Chromium de Playwright no disponible; usando ${executablePath}`);
      return chromium.launch({ headless: !visible, args, executablePath });
    }
    throw new Error(`No se pudo abrir Chromium. Ejecuta "npx playwright install chromium".\n${String(e)}`);
  }
}

function imagenesReferencia(): string[] {
  if (!fs.existsSync(DIR_REFERENCIAS)) return [];
  return fs
    .readdirSync(DIR_REFERENCIAS)
    .filter((f) => /\.(png|jpe?g|webp|gif|avif)$/i.test(f))
    .sort();
}

function hojaComparativa(fecha: string, hechas: { vista: Vista; archivo: string }[], refs: string[]): string | null {
  if (refs.length === 0) return null;
  const filas = hechas
    .map(({ vista, archivo }) => {
      const base = vista.nombre.split('-')[0];
      const propias = refs.filter((r) => r.toLowerCase().startsWith(base));
      const celdas = (propias.length ? propias : [])
        .map((r) => `<figure><img src="../referencias/${encodeURIComponent(r)}"><figcaption>${r}</figcaption></figure>`)
        .join('');
      return `<section><h2>${vista.nombre}</h2><div class="fila"><figure><img src="${path.basename(archivo)}"><figcaption>captura</figcaption></figure>${celdas || '<p class="nada">Sin referencia con este nombre</p>'}</div></section>`;
    })
    .join('\n');
  const galeria = refs.map((r) => `<figure><img src="../referencias/${encodeURIComponent(r)}"><figcaption>${r}</figcaption></figure>`).join('');
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Comparativa ${fecha}</title>
<style>body{font-family:sans-serif;background:#15181c;color:#eee;margin:16px}h2{margin:24px 0 8px}
.fila,.galeria{display:flex;gap:12px;flex-wrap:wrap}figure{margin:0;max-width:640px}img{max-width:100%;display:block;border:1px solid #333}
figcaption{font-size:12px;opacity:.7;padding:4px 0}.nada{opacity:.6}</style>
<h1>Capturas ${fecha} vs referencias/</h1>${filas}<h2>Todas las referencias</h2><div class="galeria">${galeria}</div></html>`;
  const destino = path.join(DIR_CAPTURAS, `comparativa_${fecha}.html`);
  fs.writeFileSync(destino, html);
  return destino;
}

async function main(): Promise<void> {
  const filtro = process.argv.slice(2);
  const vistas = filtro.length ? VISTAS.filter((v) => filtro.includes(v.nombre)) : VISTAS;
  if (vistas.length === 0) {
    console.error(`Ninguna vista coincide. Disponibles: ${VISTAS.map((v) => v.nombre).join(', ')}`);
    process.exit(1);
  }
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const fecha = marcaDeTiempo();
  const { base, servidor } = await prepararServidor();
  const navegador = await lanzarChromium();
  const contexto = await navegador.newContext({ viewport: { width: ANCHO, height: ALTO }, deviceScaleFactor: 1 });
  const hechas: { vista: Vista; archivo: string }[] = [];
  let conErrores = 0;

  try {
    for (const vista of vistas) {
      const pagina = await contexto.newPage();
      const errores: string[] = [];
      pagina.on('console', (m) => {
        if (m.type() === 'error') errores.push(m.text());
      });
      pagina.on('pageerror', (e) => errores.push(e.message));
      const inicio = Date.now();
      await pagina.goto(`${base}?${vista.query}`, { waitUntil: 'load' });
      await pagina.waitForFunction(() => window.__juegoListo === true, null, { timeout: ESPERA_MS, polling: 250 });
      // Unos fotogramas más para que se asienten sombras, partículas y animación
      await pagina.waitForTimeout(800);
      const archivo = path.join(DIR_CAPTURAS, `${vista.nombre}_${fecha}.png`);
      await pagina.screenshot({ path: archivo });
      hechas.push({ vista, archivo });
      const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
      console.log(`✔ ${vista.nombre.padEnd(18)} ${path.relative(RAIZ, archivo)}  (${segundos} s)`);
      if (errores.length) {
        conErrores++;
        for (const e of errores) console.log(`   ⚠ consola: ${e}`);
      }
      await pagina.close();
    }
  } finally {
    await navegador.close();
    await servidor?.close();
  }

  const refs = imagenesReferencia();
  const hoja = hojaComparativa(fecha, hechas, refs);
  console.log(`\n${hechas.length} capturas en ${path.relative(RAIZ, DIR_CAPTURAS)}/`);
  if (hoja) console.log(`Comparativa con ${refs.length} referencias: ${path.relative(RAIZ, hoja)}`);
  else console.log('referencias/ no tiene imágenes: no se genera comparativa.');
  if (conErrores) {
    console.log(`${conErrores} vista(s) con errores en consola.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
