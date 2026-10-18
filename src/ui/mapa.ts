import type { ContextoJuego } from '../core/contexto';
import { nombreCorto } from '../titans/especiales';
import type { EspecialTitan } from '../core/tipos';
import type { GestorPueblos } from '../missions/pueblos';
import { contorno } from '../world/formas';
import { REGION } from '../world/region';
import type { Destinos, Sitio } from './destinos';
import { aLienzo, aMundo, arrastrar, coordenadas, distancia, leerCoordenadas, limitar, pasoCuadricula, rumbo, zoomEn, type Vista } from './logicaMapa';

/**
 * Mapa del territorio (tecla M o ⌖ Mapa): vista cenital con el norte arriba. No pausa el juego.
 *
 * - Arrastrar mueve el mapa; la rueda, pellizcar o los botones + / − acercan y alejan; ◎ te centra
 *   y ⌂ enseña todo el territorio. Una cuadrícula con coordenadas (x hacia el este, z hacia el sur)
 *   se adapta al zoom.
 * - Tocar (o clic) elige el **destino**: un lugar, una de tus marcas o cualquier punto. Se ve en el
 *   mundo como una columna de luz dorada, en la brújula y aquí con una línea desde ti.
 * - Mantener pulsado (o clic derecho) guarda una **marca** con nombre; en el panel puedes ir a
 *   ella, borrarla, guardar el destino como marca, escribir unas coordenadas o mandar al
 *   escuadrón al destino.
 *
 * Se dibuja encima, cada fotograma mientras está abierto, lo vivo: lugares (los no descubiertos
 * como «?»), depósitos, el escuadrón con sus puntos de orden, los titanes a menos de 600 m (los
 * cuadrúpedos, en triángulo), los cambiantes, tu caballo y tu flecha.
 */

const K_MIN = 0.12;
const K_MAX = 3;
/** Radio (px) para tocar un lugar o una marca. */
const TOQUE = 16;
const PULSACION_LARGA = 550;

export class Mapa {
  private readonly raiz: HTMLDivElement;
  private readonly lienzo: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly fijo = document.createElement('canvas');
  private fijoClave = '';
  /** Pueblos del mundo abierto (estado de cada uno). */
  pueblos: (() => GestorPueblos | null) | null = null;
  /** Próximo asalto de un cambiante a Trost (o null si hay uno en curso). */
  asaltos: (() => { tipo: EspecialTitan; segundos: number; espera: boolean } | null) | null = null;
  /** Destino y marcas (compartidos con la brújula y la columna de luz del mundo). */
  destinos: Destinos | null = null;
  /** Manda al escuadrón a un punto («Id allí»); devuelve el aviso. */
  mandarEscuadron: ((x: number, z: number) => string) | null = null;
  private readonly avisoAsalto: HTMLDivElement;
  private readonly infoDestino: HTMLDivElement;
  private readonly listaMarcas: HTMLUListElement;
  private readonly textoYo: HTMLDivElement;
  private readonly textoCursor: HTMLDivElement;
  private readonly entrada: HTMLInputElement;
  private readonly botonesDestino: HTMLDivElement;
  private vista: Vista = { cx: 0, cz: 600, k: 0.2, ancho: 760, alto: 760 };
  private ctx: ContextoJuego | null = null;
  /** Punteros sobre el lienzo (para arrastrar y pellizcar). */
  private readonly punteros = new Map<number, { x: number; y: number }>();
  private gesto: { x: number; y: number; t0: number; movido: boolean; largo: number | null } | null = null;
  private pellizco: { d: number; mx: number; my: number } | null = null;
  private cursor: { x: number; z: number } | null = null;
  private versionMarcas = '';
  private tPanel = 0;
  private panelSucio = true;
  /** Al abrir se centra en ti la primera vez. */
  private centrado = false;

  constructor(contenedor: HTMLElement) {
    this.raiz = document.createElement('div');
    this.raiz.className = 'hud-mapa';
    this.raiz.hidden = true;
    this.raiz.innerHTML = `
      <div class="mapa-cuerpo">
        <div class="mapa-lienzo">
          <canvas></canvas>
          <div class="mapa-zoom">
            <button data-z="mas" title="Acercar">+</button>
            <button data-z="menos" title="Alejar">−</button>
            <button data-z="yo" title="Centrar en mí">◎</button>
            <button data-z="todo" title="Todo el territorio">⌂</button>
          </div>
        </div>
        <div class="mapa-panel">
          <div class="cab"><span>MAPA</span><button class="cerrar" title="Cerrar (M)">✕</button></div>
          <div class="sec">
            <div class="tit">Destino</div>
            <div class="info-destino"></div>
            <div class="botones-destino">
              <button data-a="escuadron" title="Mandar al escuadrón (Id allí)">⚑ Escuadrón allí</button>
              <button data-a="guardar" title="Guardar como marca">📍 Guardar</button>
              <button data-a="quitar" title="Quitar el destino">✕ Quitar</button>
            </div>
          </div>
          <div class="sec">
            <div class="tit">Marcas</div>
            <ul class="marcas"></ul>
          </div>
          <div class="sec">
            <div class="tit">Coordenadas</div>
            <div class="yo"></div>
            <div class="cursor"></div>
            <form class="ir"><input type="text" inputmode="text" placeholder="x, z   (ej. 300, -150)" aria-label="Coordenadas x, z"><button type="submit">Ir</button></form>
          </div>
          <div class="asalto"></div>
          <div class="ayuda"><b>Toca</b>: destino · <b>mantén</b> o clic derecho: marca · <b>arrastra</b>: mover · rueda o pellizco: zoom</div>
          <div class="leyenda"><span class="l-jugador">▲</span> tú · <span class="l-soldado">●</span> escuadrón · <span class="l-caballo">●</span> caballo · <span class="l-titan">●</span> titanes · <span class="l-deposito">■</span> recarga · <span class="l-destino">◆</span> destino · <span class="l-marca">⬤</span> marca<br>Pueblos: <span class="l-tomado">◆</span> tomado · <span class="l-obras">◆</span> reconstruyendo · <span class="l-paz">◆</span> en paz</div>
        </div>
      </div>`;
    this.lienzo = this.raiz.querySelector('canvas')!;
    this.g = this.lienzo.getContext('2d');
    this.avisoAsalto = this.raiz.querySelector('.asalto')!;
    this.infoDestino = this.raiz.querySelector('.info-destino')!;
    this.botonesDestino = this.raiz.querySelector('.botones-destino')!;
    this.listaMarcas = this.raiz.querySelector('.marcas')!;
    this.textoYo = this.raiz.querySelector('.yo')!;
    this.textoCursor = this.raiz.querySelector('.cursor')!;
    this.entrada = this.raiz.querySelector('.ir input')!;
    contenedor.appendChild(this.raiz);
    this.conectar();
  }

  get abierto(): boolean {
    return !this.raiz.hidden;
  }

  alternar(): void {
    if (this.raiz.hidden) this.abrir();
    else this.cerrar();
  }

  abrir(): void {
    this.raiz.hidden = false;
    // en el ordenador suelta el ratón para poder tocar el mapa (al cerrar, un clic lo recaptura)
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.centrado = false;
    this.versionMarcas = '';
  }

  cerrar(): void {
    this.raiz.hidden = true;
    this.punteros.clear();
    this.gesto = null;
    this.pellizco = null;
    this.entrada.blur();
  }

  // ─────────────────────────── Interacción ───────────────────────────

  private conectar(): void {
    const l = this.lienzo;
    // las teclas escritas en la casilla de coordenadas no mueven al soldado
    this.entrada.addEventListener('keydown', (e) => e.stopPropagation());
    this.raiz.querySelector('.ir')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const c = leerCoordenadas(this.entrada.value);
      if (!c) {
        this.entrada.value = '';
        this.entrada.placeholder = 'Escribe dos números: x, z';
        return;
      }
      this.irA({ x: c.x, z: c.z, nombre: `Coordenadas (${coordenadas(c.x, c.z)})` });
      this.centrarEn(c.x, c.z);
      this.entrada.blur();
    });
    this.raiz.querySelector('.cerrar')!.addEventListener('click', () => this.cerrar());
    // tocar fuera del mapa y del panel lo cierra
    this.raiz.addEventListener('pointerdown', (e) => {
      if (e.target === this.raiz) this.cerrar();
    });
    for (const b of this.raiz.querySelectorAll<HTMLButtonElement>('.mapa-zoom button')) {
      b.addEventListener('click', () => {
        const v = this.vista;
        if (b.dataset.z === 'mas') this.vista = zoomEn(v, 1.6, v.ancho / 2, v.alto / 2, this.kMin, this.kMax);
        else if (b.dataset.z === 'menos') this.vista = zoomEn(v, 1 / 1.6, v.ancho / 2, v.alto / 2, this.kMin, this.kMax);
        else if (b.dataset.z === 'yo' && this.ctx) this.centrarEn(this.ctx.jugador.posicion.x, this.ctx.jugador.posicion.z);
        else if (b.dataset.z === 'todo') this.verTodo();
      });
    }
    this.botonesDestino.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.a;
      const d = this.destinos?.destino;
      if (!a || !d || !this.destinos) return;
      this.panelSucio = true;
      if (a === 'quitar') this.destinos.quitarDestino();
      else if (a === 'guardar') {
        const m = this.destinos.marcar(d.x, d.z, d.nombre.startsWith('Coordenadas') || d.nombre === 'Punto del mapa' ? undefined : d.nombre);
        if (!m) this.avisar('Ya tienes 12 marcas: borra alguna');
      } else if (a === 'escuadron' && this.mandarEscuadron) this.avisar(this.mandarEscuadron(d.x, d.z));
    });
    this.listaMarcas.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      const ds = this.destinos;
      if (!b || !ds) return;
      const m = ds.marcas[Number(b.dataset.i)];
      if (!m) return;
      this.panelSucio = true;
      if (b.dataset.a === 'borrar') ds.quitarMarca(m);
      else {
        this.irA(m);
        this.centrarEn(m.x, m.z);
      }
    });

    l.addEventListener('contextmenu', (e) => e.preventDefault());
    l.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      l.setPointerCapture(e.pointerId);
      const p = this.punto(e);
      this.punteros.set(e.pointerId, p);
      if (this.punteros.size === 1) {
        // clic derecho: marca al momento; si no, tocar o mantener
        if (e.button === 2) {
          this.marcarEn(p.x, p.y);
          this.gesto = null;
          return;
        }
        const g = { x: p.x, y: p.y, t0: performance.now(), movido: false, largo: null as number | null };
        // al cumplirse el tiempo solo avisa (vibra); la marca se pone al soltar sin haber movido
        g.largo = window.setTimeout(() => {
          if (!g.movido && this.gesto === g && navigator.vibrate) navigator.vibrate(20);
        }, PULSACION_LARGA);
        this.gesto = g;
      } else if (this.punteros.size === 2) {
        this.cancelarGesto();
        this.pellizco = this.medirPellizco();
      }
    });
    l.addEventListener('pointermove', (e) => {
      const p = this.punto(e);
      this.cursor = aMundo(this.vista, p.x, p.y);
      const antes = this.punteros.get(e.pointerId);
      if (!antes) return;
      this.punteros.set(e.pointerId, p);
      if (this.punteros.size === 2 && this.pellizco) {
        const ahora = this.medirPellizco();
        if (ahora && this.pellizco.d > 0) {
          this.vista = zoomEn(this.vista, ahora.d / this.pellizco.d, ahora.mx, ahora.my, this.kMin, this.kMax);
          this.vista = arrastrar(this.vista, ahora.mx - this.pellizco.mx, ahora.my - this.pellizco.my);
          this.pellizco = ahora;
          this.ajustar();
        }
        return;
      }
      const g = this.gesto;
      if (!g) return;
      if (!g.movido && Math.hypot(p.x - g.x, p.y - g.y) > 8 * this.dpr) g.movido = true;
      if (g.movido) {
        this.vista = arrastrar(this.vista, p.x - antes.x, p.y - antes.y);
        this.ajustar();
      }
    });
    const soltar = (e: PointerEvent) => {
      const g = this.gesto;
      this.punteros.delete(e.pointerId);
      if (this.punteros.size < 2) this.pellizco = null;
      if (!g || this.punteros.size > 0) return;
      this.cancelarGesto();
      if (g.movido || e.type !== 'pointerup') return;
      // mantenido sin mover: marca; un toque: destino
      if (performance.now() - g.t0 >= PULSACION_LARGA) this.marcarEn(g.x, g.y);
      else this.tocar(g.x, g.y);
    };
    l.addEventListener('pointerup', soltar);
    l.addEventListener('pointercancel', soltar);
    l.addEventListener('pointerleave', () => (this.cursor = null));
    l.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = this.punto(e);
        this.vista = zoomEn(this.vista, Math.exp(-e.deltaY * 0.0015), p.x, p.y, this.kMin, this.kMax);
        this.ajustar();
      },
      { passive: false },
    );
  }

  private get dpr(): number {
    return Math.min(2, window.devicePixelRatio || 1);
  }

  /** Límites del zoom en píxeles del lienzo por metro (el lienzo va a la resolución de la pantalla). */
  private get kMin(): number {
    return K_MIN * this.dpr;
  }

  private get kMax(): number {
    return K_MAX * this.dpr;
  }

  /** Punto del evento en píxeles del lienzo. */
  private punto(e: MouseEvent): { x: number; y: number } {
    const r = this.lienzo.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * this.lienzo.width, y: ((e.clientY - r.top) / Math.max(1, r.height)) * this.lienzo.height };
  }

  private medirPellizco(): { d: number; mx: number; my: number } | null {
    const ps = [...this.punteros.values()];
    if (ps.length < 2) return null;
    return { d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), mx: (ps[0].x + ps[1].x) / 2, my: (ps[0].y + ps[1].y) / 2 };
  }

  private cancelarGesto(): void {
    if (this.gesto?.largo) clearTimeout(this.gesto.largo);
    this.gesto = null;
  }

  private ajustar(): void {
    this.vista = limitar(this.vista, REGION.x0, REGION.x1, REGION.z0, REGION.z1);
  }

  private centrarEn(x: number, z: number): void {
    this.vista = limitar({ ...this.vista, cx: x, cz: z, k: Math.max(this.vista.k, 0.35 * this.dpr) }, REGION.x0, REGION.x1, REGION.z0, REGION.z1);
  }

  private verTodo(): void {
    const v = this.vista;
    const k = Math.min(v.ancho / (REGION.x1 - REGION.x0 + 200), v.alto / (REGION.z1 - REGION.z0 + 200));
    this.vista = { ...v, k: Math.max(this.kMin, k), cx: (REGION.x0 + REGION.x1) / 2, cz: (REGION.z0 + REGION.z1) / 2 };
  }

  /** Tocar: una marca o un lugar cercanos, o el punto tocado, pasa a ser el destino. */
  private tocar(px: number, py: number): void {
    const cerca = this.sitioEn(px, py);
    const w = aMundo(this.vista, px, py);
    this.irA(cerca ?? { x: w.x, z: w.z, nombre: 'Punto del mapa' });
  }

  private marcarEn(px: number, py: number): void {
    const ds = this.destinos;
    if (!ds) return;
    const lugar = this.sitioEn(px, py, true);
    const w = lugar ?? aMundo(this.vista, px, py);
    const m = ds.marcar(w.x, w.z, lugar?.nombre);
    this.panelSucio = true;
    this.avisar(m ? `${m.nombre} guardada (${coordenadas(m.x, m.z)})` : 'Ya tienes 12 marcas: borra alguna');
  }

  private irA(s: Sitio): void {
    if (!this.destinos || !this.ctx) return;
    this.destinos.irA(s, this.ctx);
    this.panelSucio = true;
  }

  /** Marca o lugar bajo el punto del lienzo (solo lugares con `soloLugares`). */
  private sitioEn(px: number, py: number, soloLugares = false): Sitio | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const r = TOQUE * this.dpr;
    const cerca = (x: number, z: number) => {
      const p = aLienzo(this.vista, x, z);
      return Math.hypot(p.px - px, p.py - py) < r;
    };
    if (!soloLugares) for (const m of this.destinos?.marcas ?? []) if (cerca(m.x, m.z)) return m;
    for (const l of ctx.mundo.lugares) {
      if (l.tipo === 'bosque' || !cerca(l.pos.x, l.pos.z)) continue;
      return { x: l.pos.x, z: l.pos.z, nombre: l.descubierto ? l.nombre : 'Lugar por descubrir' };
    }
    return null;
  }

  private avisar(texto: string): void {
    this.ctx?.eventos.emit({ tipo: 'mensaje', texto, segundos: 2.2 });
  }

  // ─────────────────────────── Panel ───────────────────────────

  /** «Próximo asalto a Trost: el Colosal en unos 12 min». */
  private textoAsalto(ctx: ContextoJuego): void {
    const p = this.asaltos?.();
    let texto = '';
    if (ctx.mundo.muralla.rota) texto = '¡La puerta sur de Trost está rota!';
    else if (!p) texto = this.asaltos ? '¡Asalto a la puerta sur de Trost en curso!' : '';
    else {
      const min = Math.max(1, Math.round(p.segundos / 60));
      const cuando = p.segundos < 60 ? `en ${Math.ceil(p.segundos)} s` : `en unos ${min} min`;
      texto = `Próximo asalto a Trost: ${nombreCorto(p.tipo)} ${cuando}${p.espera ? ' (solo si estás a menos de 1,3 km de Trost)' : ''}`;
    }
    if (this.avisoAsalto.textContent !== texto) this.avisoAsalto.textContent = texto;
    this.avisoAsalto.hidden = !texto;
  }

  private actualizarPanel(ctx: ContextoJuego): void {
    const j = ctx.jugador.posicion;
    const ds = this.destinos;
    const d = ds?.destino ?? null;
    const lejos = (s: Sitio) => `${distancia(Math.hypot(s.x - j.x, s.z - j.z))} ${rumbo(s.x - j.x, s.z - j.z)}`;
    const info = d ? `<b>${escapar(d.nombre)}</b><br>${lejos(d)} · ${coordenadas(d.x, d.z)}` : 'Toca el mapa (o un lugar) para elegirlo';
    if (this.infoDestino.innerHTML !== info) this.infoDestino.innerHTML = info;
    this.botonesDestino.hidden = !d;
    const marcas = ds?.marcas ?? [];
    const version = marcas.map((m) => `${m.nombre}|${Math.round(Math.hypot(m.x - j.x, m.z - j.z) / 10)}`).join(';');
    if (version !== this.versionMarcas) {
      this.versionMarcas = version;
      this.listaMarcas.innerHTML = marcas.length
        ? marcas.map((m, i) => `<li><button class="ir-marca" data-i="${i}" data-a="ir">📍 ${escapar(m.nombre)} <small>${lejos(m)}</small></button><button class="borrar" data-i="${i}" data-a="borrar" title="Borrar">✕</button></li>`).join('')
        : '<li class="vacio">Mantén pulsado en el mapa (o clic derecho) para guardar un sitio</li>';
    }
    const yo = `Tú: ${coordenadas(j.x, j.z)}`;
    if (this.textoYo.textContent !== yo) this.textoYo.textContent = yo;
    const cur = this.cursor ? `Cursor: ${coordenadas(this.cursor.x, this.cursor.z)} · ${lejos({ ...this.cursor, nombre: '' })}` : '';
    if (this.textoCursor.textContent !== cur) this.textoCursor.textContent = cur;
  }

  // ─────────────────────────── Dibujo ───────────────────────────

  /** El lienzo a la resolución de la pantalla (nítido al acercar). */
  private ajustarTamano(): void {
    const r = this.lienzo.getBoundingClientRect();
    const w = Math.max(64, Math.round(r.width * this.dpr));
    const h = Math.max(64, Math.round(r.height * this.dpr));
    if (this.lienzo.width === w && this.lienzo.height === h) return;
    // mantiene la misma zona a la vista al cambiar el tamaño
    const escala = this.vista.ancho > 0 ? w / this.vista.ancho : 1;
    this.lienzo.width = w;
    this.lienzo.height = h;
    this.vista = { ...this.vista, ancho: w, alto: h, k: Math.min(this.kMax, this.vista.k * escala) };
  }

  /** Capa fija (suelo, bosques, río, caminos, edificios, Trost y cuadrícula) para la vista actual. */
  private dibujarFijo(ctx: ContextoJuego): void {
    const v = this.vista;
    const clave = `${v.cx.toFixed(1)}|${v.cz.toFixed(1)}|${v.k.toFixed(4)}|${v.ancho}|${v.alto}`;
    if (clave === this.fijoClave) return;
    this.fijoClave = clave;
    const c = this.fijo;
    if (c.width !== v.ancho || c.height !== v.alto) {
      c.width = v.ancho;
      c.height = v.alto;
    }
    const g = c.getContext('2d');
    if (!g) return;
    const mundo = ctx.mundo;
    const s = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#3c3a2c';
    g.fillRect(0, 0, v.ancho, v.alto);
    // del mundo al lienzo: todo lo que sigue se dibuja en metros
    g.setTransform(v.k, 0, 0, v.k, v.ancho / 2 - v.cx * v.k, v.alto / 2 - v.cz * v.k);
    const px = (n: number) => n / v.k; // grosor en píxeles de pantalla
    g.fillStyle = '#5b5a3f';
    g.fillRect(REGION.x0, REGION.z0, REGION.x1 - REGION.x0, REGION.z1 - REGION.z0);
    for (const b of mundo.bosques) {
      const puntos = contorno(b.forma, 64);
      g.beginPath();
      puntos.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.z) : g.lineTo(p.x, p.z)));
      g.closePath();
      g.fillStyle = b.tipo === 'gigante' ? '#26391f' : '#2f4a27';
      g.fill();
      g.strokeStyle = 'rgba(160, 40, 30, 0.55)';
      g.lineWidth = px(1.5 * s);
      g.stroke();
    }
    const linea = (pts: readonly { x: number; z: number }[], ancho: number, color: string) => {
      g.beginPath();
      pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.z) : g.lineTo(p.x, p.z)));
      g.strokeStyle = color;
      g.lineWidth = ancho;
      g.lineJoin = 'round';
      g.stroke();
    };
    for (const camino of mundo.plano.caminos) linea(camino, Math.max(px(2 * s), 4), '#8c7650');
    linea(mundo.plano.rio, Math.max(px(2 * s), mundo.plano.anchoRio), '#4f7896');
    g.fillStyle = '#a89b82';
    for (const e of mundo.plano.edificios) {
      g.save();
      g.translate(e.x, e.z);
      g.rotate(-e.rotY);
      g.fillRect(-e.ancho / 2, -e.fondo / 2, Math.max(px(1.5 * s), e.ancho), Math.max(px(1.5 * s), e.fondo));
      g.restore();
    }
    for (const t of mundo.plano.torres) {
      g.beginPath();
      g.arc(t.x, t.z, Math.max(px(2 * s), t.r), 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#7a6d5c';
    g.beginPath();
    g.arc(0, 0, mundo.muralla.radioInterior, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#d8d0c0';
    g.lineWidth = Math.max(px(2 * s), mundo.muralla.radioExterior - mundo.muralla.radioInterior);
    g.stroke();
    // cuadrícula con su paso según el zoom
    const paso = pasoCuadricula(v.k / s);
    const a = aMundo(v, 0, 0);
    const b = aMundo(v, v.ancho, v.alto);
    g.strokeStyle = 'rgba(240, 232, 210, 0.13)';
    g.lineWidth = px(1 * s);
    g.beginPath();
    for (let x = Math.ceil(a.x / paso) * paso; x <= b.x; x += paso) {
      g.moveTo(x, a.z);
      g.lineTo(x, b.z);
    }
    for (let z = Math.ceil(a.z / paso) * paso; z <= b.z; z += paso) {
      g.moveTo(a.x, z);
      g.lineTo(b.x, z);
    }
    g.stroke();
    // textos a tamaño fijo de pantalla
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(240, 232, 210, 0.55)';
    g.font = `${10 * s}px Georgia, serif`;
    for (let x = Math.ceil(a.x / paso) * paso; x <= b.x; x += paso) g.fillText(String(x).replace('-', '−'), aLienzo(v, x, 0).px, 12 * s);
    g.textAlign = 'left';
    for (let z = Math.ceil(a.z / paso) * paso; z <= b.z; z += paso) g.fillText(String(z).replace('-', '−'), 4 * s, aLienzo(v, 0, z).py - 3 * s);
    g.textAlign = 'center';
    g.fillStyle = '#efe6d2';
    g.font = `600 ${13 * s}px Georgia, serif`;
    const trost = aLienzo(v, 0, 0);
    g.fillText('TROST', trost.px, trost.py + 4 * s);
    g.font = `italic ${11 * s}px Georgia, serif`;
    g.fillStyle = 'rgba(230, 220, 200, 0.85)';
    for (const bo of mundo.bosques) {
      const p = aLienzo(v, bo.centro.x, bo.centro.z);
      g.fillText(bo.nombre, p.px, p.py);
    }
    // rosa de los vientos
    g.font = `600 ${12 * s}px Georgia, serif`;
    g.fillStyle = 'rgba(240, 232, 210, 0.8)';
    g.fillText('N ▲', v.ancho - 22 * s, 18 * s);
  }

  /** Redibuja (solo con el mapa abierto). `yaw` = cámara. */
  actualizar(ctx: ContextoJuego, yaw: number): void {
    if (this.raiz.hidden || !this.g) return;
    this.ctx = ctx;
    this.ajustarTamano();
    if (!this.centrado) {
      this.centrado = true;
      this.centrarEn(ctx.jugador.posicion.x, ctx.jugador.posicion.z);
    }
    const ahora = performance.now();
    if (this.panelSucio || ahora - this.tPanel > 250) {
      this.tPanel = ahora;
      this.panelSucio = false;
      this.actualizarPanel(ctx);
      this.textoAsalto(ctx);
    }
    const g = this.g;
    const v = this.vista;
    const s = this.dpr;
    this.dibujarFijo(ctx);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.fijo, 0, 0);
    const P = (x: number, z: number) => aLienzo(v, x, z);
    g.textAlign = 'center';
    // Lugares
    const pueblos = this.pueblos?.()?.lista ?? [];
    const parpadeo = Math.floor(performance.now() / 300) % 2 === 0;
    for (const l of ctx.mundo.lugares) {
      if (l.tipo === 'bosque') continue;
      const { px: x, py: y } = P(l.pos.x, l.pos.z);
      if (x < -50 || y < -50 || x > v.ancho + 50 || y > v.alto + 50) continue;
      const pueblo = pueblos.find((p) => p.datos.id === l.id);
      g.font = `${11 * s}px Georgia, serif`;
      if (pueblo) {
        const f = pueblo.logica.fase;
        g.fillStyle = pueblo.enAlarma && parpadeo ? '#ffffff' : f === 'enPaz' ? '#9ee07a' : f === 'tomado' ? '#e0453a' : '#f2c94c';
        rombo(g, x, y, 6 * s);
        g.fillStyle = '#f4ecd8';
        const estado = pueblo.enAlarma ? '¡atacado!' : f === 'enPaz' ? 'en paz' : f === 'tomado' ? `${pueblo.logica.ocupantes} titanes` : `${Math.floor(pueblo.logica.habitantes)} vecinos · obra ${Math.round(pueblo.logica.progreso * 100)} %`;
        g.fillText(l.descubierto ? `${l.nombre} (${estado})` : '?', x, y - 9 * s);
        continue;
      }
      g.fillStyle = l.descubierto ? '#f4ecd8' : 'rgba(244, 236, 216, 0.45)';
      circulo(g, x, y, 3.5 * s);
      g.fillText(l.descubierto ? l.nombre : '?', x, y - 7 * s);
    }
    g.fillStyle = '#9ee07a';
    for (const d of ctx.mundo.depositos) {
      const p = P(d.pos.x, d.pos.z);
      g.fillRect(p.px - 4 * s, p.py - 4 * s, 8 * s, 8 * s);
    }
    // Titanes cercanos
    const j = ctx.jugador.posicion;
    for (const t of ctx.poblacion.titanesCerca(j, 600)) {
      const { px: x, py: y } = P(t.posicion.x, t.posicion.z);
      g.fillStyle = '#e0453a';
      g.beginPath();
      if (t.cuadrupedo) {
        g.moveTo(x, y - 5 * s);
        g.lineTo(x + 4.5 * s, y + 4 * s);
        g.lineTo(x - 4.5 * s, y + 4 * s);
        g.closePath();
      } else g.arc(x, y, (2 + t.altura * 0.18) * s, 0, Math.PI * 2);
      g.fill();
    }
    // Cambiantes avistados (aunque estén lejos)
    g.font = `${11 * s}px Georgia, serif`;
    for (const t of ctx.poblacion.titanes) {
      if (!t.vivo || !t.especial) continue;
      const { px: x, py: y } = P(t.posicion.x, t.posicion.z);
      g.fillStyle = '#f2c94c';
      g.strokeStyle = '#5a1a10';
      g.lineWidth = 2 * s;
      g.beginPath();
      g.arc(x, y, 6 * s, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillText(nombreCorto(t.especial), x, y - 9 * s);
    }
    // Tu caballo
    const caballo = (ctx.jugador as { caballo?: { pos: { x: number; z: number }; montado: boolean; grupo: { visible: boolean } } | null }).caballo;
    if (caballo && !caballo.montado && caballo.grupo.visible) {
      g.fillStyle = '#c48a52';
      const p = P(caballo.pos.x, caballo.pos.z);
      circulo(g, p.px, p.py, 3.5 * s);
    }
    // Escuadrón y sus puntos de orden
    for (const so of ctx.escuadron.soldados) {
      if (!so.vivo) continue;
      const info = ctx.escuadron.info(so);
      if (info?.punto) {
        g.strokeStyle = 'rgba(240, 210, 90, 0.9)';
        g.lineWidth = 1.5 * s;
        const p = P(info.punto.x, info.punto.z);
        g.beginPath();
        g.arc(p.px, p.py, 5 * s, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#7fe39a';
      const p = P(so.posicion.x, so.posicion.z);
      circulo(g, p.px, p.py, 3 * s);
    }
    // Marcas guardadas
    g.font = `${11 * s}px Georgia, serif`;
    for (const m of this.destinos?.marcas ?? []) {
      const { px: x, py: y } = P(m.x, m.z);
      g.fillStyle = '#4fa3e0';
      g.strokeStyle = '#0d2236';
      g.lineWidth = 1.5 * s;
      g.beginPath();
      g.arc(x, y - 7 * s, 5 * s, Math.PI, 0);
      g.lineTo(x, y);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#d6ecff';
      g.fillText(m.nombre, x, y - 15 * s);
    }
    // Destino: línea desde ti y rombo dorado que late
    const { px: jx, py: jy } = P(j.x, j.z);
    const d = this.destinos?.destino;
    if (d) {
      const { px: x, py: y } = P(d.x, d.z);
      g.setLineDash([8 * s, 6 * s]);
      g.strokeStyle = 'rgba(255, 207, 90, 0.85)';
      g.lineWidth = 2 * s;
      g.beginPath();
      g.moveTo(jx, jy);
      g.lineTo(x, y);
      g.stroke();
      g.setLineDash([]);
      const late = 1 + 0.18 * Math.sin(performance.now() / 180);
      g.fillStyle = '#ffcf5a';
      g.strokeStyle = '#3a2a08';
      g.lineWidth = 2 * s;
      rombo(g, x, y, 8 * s * late, true);
      g.fillStyle = '#ffe9b0';
      g.font = `600 ${11 * s}px Georgia, serif`;
      g.fillText(`${d.nombre} · ${distancia(Math.hypot(d.x - j.x, d.z - j.z))}`, x, y + 20 * s);
    }
    // Jugador: flecha en la dirección de la cámara
    g.save();
    g.translate(jx, jy);
    g.rotate(-yaw + Math.PI);
    g.scale(s, s);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#000000';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, 8);
    g.lineTo(5.5, -6);
    g.lineTo(0, -3);
    g.lineTo(-5.5, -6);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}

function circulo(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function rombo(g: CanvasRenderingContext2D, x: number, y: number, r: number, borde = false): void {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.fill();
  if (borde) g.stroke();
}

function escapar(t: string): string {
  return t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
