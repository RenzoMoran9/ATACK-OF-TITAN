import type { ContextoJuego } from '../core/contexto';
import { nombreCorto } from '../titans/especiales';
import type { EspecialTitan } from '../core/tipos';
import type { GestorPueblos } from '../missions/pueblos';
import { contorno } from '../world/formas';
import { REGION } from '../world/region';

/**
 * Mapa del territorio (tecla M): vista cenital con el norte arriba. La capa fija (bosques,
 * muralla, río, caminos, edificios) se dibuja una vez; encima, cada fotograma mientras está
 * abierto, los lugares (los no descubiertos como «?»), depósitos, el escuadrón con sus
 * puntos de orden, los titanes a menos de 600 m (los cuadrúpedos, en triángulo) y tu flecha.
 * No pausa el juego.
 */

const MARGEN = 120;
const LADO = 760;

export class Mapa {
  private readonly raiz: HTMLDivElement;
  private readonly lienzo: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private fijo: HTMLCanvasElement | null = null;
  private readonly x0 = REGION.x0 - MARGEN;
  private readonly z0 = REGION.z0 - MARGEN;
  /** Pueblos del mundo abierto (estado de cada uno). */
  pueblos: (() => GestorPueblos | null) | null = null;
  /** Próximo asalto de un cambiante a Trost (o null si hay uno en curso). */
  asaltos: (() => { tipo: EspecialTitan; segundos: number; espera: boolean } | null) | null = null;
  private readonly avisoAsalto: HTMLDivElement;
  private readonly escala = LADO / Math.max(REGION.x1 - REGION.x0 + 2 * MARGEN, REGION.z1 - REGION.z0 + 2 * MARGEN);

  constructor(contenedor: HTMLElement) {
    this.raiz = document.createElement('div');
    this.raiz.className = 'hud-mapa';
    this.raiz.hidden = true;
    this.lienzo = document.createElement('canvas');
    this.lienzo.width = LADO;
    this.lienzo.height = LADO;
    this.g = this.lienzo.getContext('2d');
    const pie = document.createElement('div');
    pie.className = 'pie';
    pie.innerHTML =
      '<b>M</b> cerrar · <span class="l-jugador">▲</span> tú · <span class="l-soldado">●</span> escuadrón · <span class="l-caballo">●</span> caballo · <span class="l-titan">●</span> titanes · <span class="l-cuadrupedo">▲</span> a cuatro patas · <span class="l-deposito">■</span> recarga<br>' +
      'Pueblos: <span class="l-tomado">◆</span> tomado · <span class="l-obras">◆</span> reconstruyendo · <span class="l-paz">◆</span> en paz';
    this.avisoAsalto = document.createElement('div');
    this.avisoAsalto.className = 'asalto';
    this.raiz.append(this.lienzo, this.avisoAsalto, pie);
    contenedor.appendChild(this.raiz);
  }

  get abierto(): boolean {
    return !this.raiz.hidden;
  }

  alternar(): void {
    this.raiz.hidden = !this.raiz.hidden;
  }

  cerrar(): void {
    this.raiz.hidden = true;
  }

  private px(x: number): number {
    return (x - this.x0) * this.escala;
  }

  private pz(z: number): number {
    return (z - this.z0) * this.escala;
  }

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

  /** Capa fija: suelo, bosques, río, caminos, muralla y edificios. */
  private dibujarFijo(ctx: ContextoJuego): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = LADO;
    c.height = LADO;
    const g = c.getContext('2d');
    if (!g) return c;
    const mundo = ctx.mundo;
    g.fillStyle = '#3c3a2c';
    g.fillRect(0, 0, LADO, LADO);
    g.fillStyle = '#5b5a3f';
    g.fillRect(this.px(REGION.x0), this.pz(REGION.z0), (REGION.x1 - REGION.x0) * this.escala, (REGION.z1 - REGION.z0) * this.escala);
    // Bosques
    for (const b of mundo.bosques) {
      const puntos = contorno(b.forma, 64);
      g.beginPath();
      puntos.forEach((p, i) => (i === 0 ? g.moveTo(this.px(p.x), this.pz(p.z)) : g.lineTo(this.px(p.x), this.pz(p.z))));
      g.closePath();
      g.fillStyle = b.tipo === 'gigante' ? '#26391f' : '#2f4a27';
      g.fill();
      g.strokeStyle = 'rgba(160, 40, 30, 0.55)';
      g.lineWidth = 1.5;
      g.stroke();
    }
    // Río y caminos
    const linea = (pts: readonly { x: number; z: number }[], ancho: number, color: string) => {
      g.beginPath();
      pts.forEach((p, i) => (i === 0 ? g.moveTo(this.px(p.x), this.pz(p.z)) : g.lineTo(this.px(p.x), this.pz(p.z))));
      g.strokeStyle = color;
      g.lineWidth = ancho;
      g.lineJoin = 'round';
      g.stroke();
    };
    for (const camino of mundo.plano.caminos) linea(camino, 2, '#8c7650');
    linea(mundo.plano.rio, Math.max(2, mundo.plano.anchoRio * this.escala), '#4f7896');
    // Edificios y torres del territorio
    g.fillStyle = '#a89b82';
    for (const e of mundo.plano.edificios) {
      g.save();
      g.translate(this.px(e.x), this.pz(e.z));
      g.rotate(-e.rotY);
      g.fillRect((-e.ancho / 2) * this.escala, (-e.fondo / 2) * this.escala, Math.max(1.5, e.ancho * this.escala), Math.max(1.5, e.fondo * this.escala));
      g.restore();
    }
    for (const t of mundo.plano.torres) {
      g.beginPath();
      g.arc(this.px(t.x), this.pz(t.z), Math.max(2, t.r * this.escala), 0, Math.PI * 2);
      g.fill();
    }
    // Trost: casas y muralla
    g.fillStyle = '#7a6d5c';
    g.beginPath();
    g.arc(this.px(0), this.pz(0), mundo.muralla.radioInterior * this.escala, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#d8d0c0';
    g.lineWidth = Math.max(2, (mundo.muralla.radioExterior - mundo.muralla.radioInterior) * this.escala);
    g.stroke();
    g.fillStyle = '#efe6d2';
    g.font = '600 13px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('TROST', this.px(0), this.pz(0) + 4);
    // Nombres de los bosques
    g.font = 'italic 11px Georgia, serif';
    g.fillStyle = 'rgba(230, 220, 200, 0.85)';
    for (const b of mundo.bosques) g.fillText(b.nombre, this.px(b.centro.x), this.pz(b.centro.z));
    return c;
  }

  /** Redibuja la capa viva (solo con el mapa abierto). `yaw` = cámara. */
  actualizar(ctx: ContextoJuego, yaw: number): void {
    if (this.raiz.hidden || !this.g) return;
    const g = this.g;
    this.fijo ??= this.dibujarFijo(ctx);
    g.drawImage(this.fijo, 0, 0);
    this.textoAsalto(ctx);
    g.textAlign = 'center';
    // Lugares
    const pueblos = this.pueblos?.()?.lista ?? [];
    const parpadeo = Math.floor(performance.now() / 300) % 2 === 0;
    for (const l of ctx.mundo.lugares) {
      if (l.tipo === 'bosque') continue;
      const x = this.px(l.pos.x);
      const y = this.pz(l.pos.z);
      const pueblo = pueblos.find((p) => p.datos.id === l.id);
      g.font = '11px Georgia, serif';
      if (pueblo) {
        // rombo con el color del estado del pueblo; parpadea si suena su campana
        const f = pueblo.logica.fase;
        g.fillStyle = pueblo.enAlarma && parpadeo ? '#ffffff' : f === 'enPaz' ? '#9ee07a' : f === 'tomado' ? '#e0453a' : '#f2c94c';
        g.beginPath();
        g.moveTo(x, y - 6);
        g.lineTo(x + 6, y);
        g.lineTo(x, y + 6);
        g.lineTo(x - 6, y);
        g.closePath();
        g.fill();
        g.fillStyle = '#f4ecd8';
        const estado = pueblo.enAlarma ? '¡atacado!' : f === 'enPaz' ? 'en paz' : f === 'tomado' ? `${pueblo.logica.ocupantes} titanes` : `${Math.floor(pueblo.logica.habitantes)} vecinos · obra ${Math.round(pueblo.logica.progreso * 100)} %`;
        g.fillText(l.descubierto ? `${l.nombre} (${estado})` : '?', x, y - 9);
        continue;
      }
      g.fillStyle = l.descubierto ? '#f4ecd8' : 'rgba(244, 236, 216, 0.45)';
      g.beginPath();
      g.arc(x, y, 3.5, 0, Math.PI * 2);
      g.fill();
      g.fillText(l.descubierto ? l.nombre : '?', x, y - 7);
    }
    // Depósitos de recarga
    g.fillStyle = '#9ee07a';
    for (const d of ctx.mundo.depositos) g.fillRect(this.px(d.pos.x) - 4, this.pz(d.pos.z) - 4, 8, 8);
    // Titanes cercanos
    const j = ctx.jugador.posicion;
    for (const t of ctx.poblacion.titanesCerca(j, 600)) {
      const x = this.px(t.posicion.x);
      const y = this.pz(t.posicion.z);
      g.fillStyle = '#e0453a';
      g.beginPath();
      if (t.cuadrupedo) {
        g.moveTo(x, y - 5);
        g.lineTo(x + 4.5, y + 4);
        g.lineTo(x - 4.5, y + 4);
        g.closePath();
      } else g.arc(x, y, 2 + t.altura * 0.18, 0, Math.PI * 2);
      g.fill();
    }
    // Cambiantes avistados (aunque estén lejos)
    for (const t of ctx.poblacion.titanes) {
      if (!t.vivo || !t.especial) continue;
      g.fillStyle = '#f2c94c';
      g.strokeStyle = '#5a1a10';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.px(t.posicion.x), this.pz(t.posicion.z), 6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillText(nombreCorto(t.especial), this.px(t.posicion.x), this.pz(t.posicion.z) - 9);
    }
    // Tu caballo
    const caballo = (ctx.jugador as { caballo?: { pos: { x: number; z: number }; montado: boolean; grupo: { visible: boolean } } | null }).caballo;
    if (caballo && !caballo.montado && caballo.grupo.visible) {
      g.fillStyle = '#c48a52';
      g.beginPath();
      g.arc(this.px(caballo.pos.x), this.pz(caballo.pos.z), 3.5, 0, Math.PI * 2);
      g.fill();
    }
    // Escuadrón y sus puntos de orden
    for (const s of ctx.escuadron.soldados) {
      if (!s.vivo) continue;
      const info = ctx.escuadron.info(s);
      if (info?.punto) {
        g.strokeStyle = 'rgba(240, 210, 90, 0.9)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(this.px(info.punto.x), this.pz(info.punto.z), 5, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#7fe39a';
      g.beginPath();
      g.arc(this.px(s.posicion.x), this.pz(s.posicion.z), 3, 0, Math.PI * 2);
      g.fill();
    }
    // Jugador: flecha en la dirección de la cámara
    const x = this.px(j.x);
    const y = this.pz(j.z);
    g.save();
    g.translate(x, y);
    g.rotate(-yaw + Math.PI);
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
