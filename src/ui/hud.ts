import * as THREE from 'three';
import type { ContextoJuego } from '../core/contexto';
import type { Campana } from '../missions/campana';
import type { Jugador } from '../player/jugador';
import { depositoMasCercano } from '../world/mundo';
import { PanelEscuadron } from './ordenes';

/**
 * HUD: gas (dos cilindros), cuchillas, vida, retícula con indicador de anclaje por gancho,
 * objetivo del capítulo, mensajes, aviso de anormal, QTE de agarre, panel del escuadrón
 * (src/ui/ordenes.ts) y fundido al morir.
 */

interface Mensaje {
  el: HTMLDivElement;
  restante: number;
}

export class Hud {
  private readonly raiz: HTMLDivElement;
  private readonly rellenos: HTMLDivElement[] = [];
  private readonly textoGas: HTMLSpanElement;
  private readonly indicadores: HTMLDivElement[] = [];
  private readonly marcadores: HTMLDivElement[] = [];
  private readonly velocidad: HTMLDivElement;
  private readonly fps: HTMLDivElement;
  private readonly vida: HTMLDivElement;
  private readonly filo: HTMLDivElement;
  private readonly aguante: HTMLDivElement;
  private readonly repuesto: HTMLSpanElement;
  private readonly estadoCuchillas: HTMLSpanElement;
  private readonly objetivo: HTMLDivElement;
  private readonly detalle: HTMLDivElement;
  private readonly mensajesEl: HTMLDivElement;
  private readonly mensajes: Mensaje[] = [];
  private readonly qte: HTMLDivElement;
  private readonly qteTexto: HTMLDivElement;
  private readonly qteBarra: HTMLDivElement;
  private readonly escuadron: PanelEscuadron;
  private readonly sinGas: HTMLDivElement;
  private readonly anormal: HTMLDivElement;
  private readonly peligro: HTMLDivElement;
  private readonly muerte: HTMLDivElement;
  private acumFps = 0;
  private framesFps = 0;
  private reloj = 0;
  mostrarFps = false;

  constructor(contenedor: HTMLElement, visible: boolean, ctx: ContextoJuego) {
    this.raiz = document.createElement('div');
    this.raiz.className = 'hud';
    this.raiz.hidden = !visible;
    this.raiz.innerHTML = `
      <div class="hud-objetivo"><div class="titulo"></div><div class="detalle"></div></div>
      <div class="hud-mensajes"></div>
      <div class="hud-anormal" hidden>¡Titán anormal!</div>
      <div class="hud-peligro" hidden><div class="texto">¡Va a por ti! ¡Apártate o sube!</div></div>
      <div class="hud-equipo">
        <div class="hud-gas">
          <div class="cilindro"><div class="relleno"></div></div>
          <div class="cilindro"><div class="relleno"></div></div>
          <span class="etiqueta">GAS <b>100</b></span>
        </div>
        <div class="hud-barras">
          <div class="fila"><span>VIDA</span><div class="barra"><div class="vida"></div></div></div>
          <div class="fila"><span>AGUANTE</span><div class="barra"><div class="aguante"></div></div></div>
          <div class="fila"><span>FILO</span><div class="barra"><div class="filo"></div></div><span class="repuesto">×4</span></div>
          <span class="estado-cuchillas"></span>
        </div>
      </div>
      <div class="reticula">
        <div class="punto"></div>
        <div class="indicador izq"></div>
        <div class="indicador der"></div>
      </div>
      <div class="marcador izq"></div>
      <div class="marcador der"></div>
      <div class="hud-sin-gas" hidden></div>
      <div class="hud-qte" hidden><div class="texto"></div><div class="barra"><div class="tiempo"></div></div></div>
      <div class="hud-velocidad">0 m/s</div>
      <div class="hud-fps"></div>
      <div class="hud-muerte" hidden><div>Has sido devorado</div></div>`;
    contenedor.appendChild(this.raiz);
    const q = <T extends Element>(s: string) => this.raiz.querySelector(s) as unknown as T;
    this.raiz.querySelectorAll<HTMLDivElement>('.relleno').forEach((e) => this.rellenos.push(e));
    this.textoGas = q('.etiqueta b');
    this.raiz.querySelectorAll<HTMLDivElement>('.indicador').forEach((e) => this.indicadores.push(e));
    this.raiz.querySelectorAll<HTMLDivElement>('.marcador').forEach((e) => this.marcadores.push(e));
    this.velocidad = q('.hud-velocidad');
    this.fps = q('.hud-fps');
    this.vida = q('.vida');
    this.filo = q('.filo');
    this.aguante = q('.aguante');
    this.repuesto = q('.repuesto');
    this.estadoCuchillas = q('.estado-cuchillas');
    this.objetivo = q('.hud-objetivo .titulo');
    this.detalle = q('.hud-objetivo .detalle');
    this.mensajesEl = q('.hud-mensajes');
    this.qte = q('.hud-qte');
    this.qteTexto = q('.hud-qte .texto');
    this.qteBarra = q('.hud-qte .tiempo');
    this.escuadron = new PanelEscuadron(this.raiz);
    this.sinGas = q('.hud-sin-gas');
    this.anormal = q('.hud-anormal');
    this.peligro = q('.hud-peligro');
    this.muerte = q('.hud-muerte');
    ctx.eventos.on('mensaje', (e) => this.mensaje(e.texto, e.segundos ?? 3));
  }

  /** Los mensajes no se borran al cambiar de capítulo: el HUD se suscribe una vez. */
  mensaje(texto: string, segundos: number): void {
    // no repetir el mismo texto si ya está en pantalla
    const igual = this.mensajes.find((m) => m.el.textContent === texto);
    if (igual) {
      igual.restante = Math.max(igual.restante, segundos);
      return;
    }
    const el = document.createElement('div');
    el.className = 'mensaje';
    el.textContent = texto;
    this.mensajesEl.appendChild(el);
    this.mensajes.push({ el, restante: segundos });
    while (this.mensajes.length > 4) this.mensajes.shift()!.el.remove();
  }

  /**
   * Con poco gas (o ninguno): qué puedes hacer. Pedirlo a un compañero (G), recoger el
   * equipo de un caído (G a su lado), ir al depósito o seguir a pie hasta un tejado.
   */
  private panelGas(ctx: ContextoJuego, jugador: Jugador, campana: Campana | null): void {
    const frac = jugador.gas.nivel / jugador.gas.capacidad;
    const mostrar = jugador.vivo && frac < 0.2;
    this.sinGas.hidden = !mostrar;
    if (!mostrar) return;
    const flecha = (p: THREE.Vector3) => flechaHacia(ctx.camara, p);
    const lineas: string[] = [];
    const vacio = jugador.gas.nivel <= 0.5;
    lineas.push(`<div class="titulo ${vacio ? 'vacio' : ''}">${vacio ? 'SIN GAS' : 'POCO GAS'}</div>`);
    const equipo = ctx.suministros.masCercano(jugador.pos);
    const alLado = !!equipo && equipo.distancia <= 4;
    const donante = ctx.escuadron.donanteGas();
    if (donante) lineas.push(`<div>${alLado ? '' : '<b>G</b> '}Pedir gas a ${donante.nombre} <i>${Math.round(donante.posicion.distanceTo(jugador.pos))} m ${flecha(donante.posicion)}</i></div>`);
    if (equipo && equipo.distancia < 250) {
      const texto = alLado ? `<b>G</b> Recoger el ${equipo.equipo.origen}` : `Recoger el ${equipo.equipo.origen}`;
      lineas.push(`<div>${texto} <i>${Math.round(equipo.distancia)} m ${flecha(equipo.equipo.pos)}</i></div>`);
    }
    if (campana?.depositoDisponible() ?? true) {
      const { deposito, distancia } = depositoMasCercano(ctx.mundo, jugador.pos);
      lineas.push(`<div>${deposito.nombre} <i>${Math.round(distancia)} m ${flecha(deposito.pos)}</i></div>`);
    } else lineas.push('<div class="apagado">Depósito tomado por titanes: despéjalo</div>');
    if (vacio) lineas.push('<div class="apagado">A pie: Shift para correr, Espacio para saltar; busca un tejado</div>');
    const html = lineas.join('');
    if (this.sinGas.innerHTML !== html) this.sinGas.innerHTML = html;
  }

  actualizar(dt: number, ctx: ContextoJuego, jugador: Jugador, campana: Campana | null, ancho: number, alto: number): void {
    this.reloj += dt;
    const frac = jugador.gas.fraccion;
    for (const r of this.rellenos) {
      r.style.height = `${(frac * 100).toFixed(1)}%`;
      r.classList.toggle('bajo', frac < 0.2);
    }
    this.textoGas.textContent = Math.round(jugador.gas.nivel).toString();
    this.vida.style.width = `${(jugador.salud / jugador.saludMax) * 100}%`;
    this.vida.classList.toggle('bajo', jugador.salud < 30);
    const ag = jugador.aguante;
    this.aguante.style.width = `${(ag.fraccion * 100).toFixed(1)}%`;
    this.aguante.classList.toggle('agotado', ag.agotado);
    this.aguante.parentElement!.parentElement!.classList.toggle('llena', ag.fraccion >= 0.999);
    const c = jugador.combate?.cuchillas;
    if (c) {
      this.filo.style.width = `${c.filo * 100}%`;
      this.filo.classList.toggle('bajo', c.mellada || c.rota);
      this.repuesto.textContent = `×${c.repuesto}`;
      this.estadoCuchillas.textContent = c.cambiando > 0 ? 'Cambiando…' : c.rota ? 'ROTAS · R' : c.mellada ? 'Melladas · R' : '';
    }

    jugador.odm.apuntes.forEach((a, i) => {
      const g = jugador.odm.ganchos[i];
      const ind = this.indicadores[i];
      ind.classList.toggle('valido', a.valido);
      ind.classList.toggle('activo', g.estado === 'anclado');
      ind.classList.toggle('titan', a.valido && (a.etiqueta === 'titan' || a.etiqueta === 'nuca'));
      const m = this.marcadores[i];
      m.hidden = true;
      if (a.punto && a.valido) {
        const p = a.punto.clone().project(ctx.camara);
        const x = ((p.x + 1) / 2) * ancho;
        const y = ((1 - p.y) / 2) * alto;
        // pegado al centro sobra: ya lo dicen los arcos de la retícula
        if (p.z < 1 && Math.hypot(x - ancho / 2, y - alto / 2) > 24) {
          m.hidden = false;
          m.style.transform = `translate(${x}px, ${y}px)`;
          m.classList.toggle('titan', a.etiqueta === 'titan' || a.etiqueta === 'nuca');
        }
      }
    });

    this.velocidad.textContent = `${jugador.vel.length().toFixed(0)} m/s`;

    // Objetivo
    if (campana && campana.capitulo) {
      this.objetivo.textContent = campana.objetivoTexto;
      this.detalle.textContent = campana.objetivoDetalle;
      this.objetivo.parentElement!.hidden = !campana.objetivoTexto;
    } else this.objetivo.parentElement!.hidden = true;

    // Mensajes
    for (let i = this.mensajes.length - 1; i >= 0; i--) {
      const m = this.mensajes[i];
      m.restante -= dt;
      m.el.style.opacity = String(Math.min(1, m.restante * 2));
      if (m.restante <= 0) {
        m.el.remove();
        this.mensajes.splice(i, 1);
      }
    }
    this.panelGas(ctx, jugador, campana);

    // Aviso de agarre: un titán va a cerrar la mano (o a saltar) sobre ti
    const teAtrapa = jugador.vivo && !jugador.agarradoPor && ctx.poblacion.titanes.some((t) => t.vivo && t.avisando && t.objetivo === jugador);
    this.peligro.hidden = !teAtrapa;

    // Aviso de anormal cercano
    const anormalCerca = ctx.poblacion.titanes.filter((t) => t.vivo && t.anormal && t.posicion.distanceTo(jugador.pos) < 120);
    this.anormal.hidden = anormalCerca.length === 0;
    const texto = anormalCerca.some((t) => t.cuadrupedo) ? '¡Corre a cuatro patas!' : '¡Titán anormal!';
    if (this.anormal.textContent !== texto) this.anormal.textContent = texto;

    // QTE de agarre
    const qte = jugador.combate?.qte;
    this.qte.hidden = !qte || !jugador.agarradoPor;
    if (qte) {
      this.qteTexto.textContent = qte.restante > 0 ? `¡Pulsa F! ${qte.hechas}/${qte.necesarias}` : 'No llegas… ¡que alguien te ayude!';
      this.qteBarra.style.width = `${(qte.restante / qte.total) * 100}%`;
    }

    // Escuadrón: a quién mandas y qué hace cada uno
    this.escuadron.actualizar(dt, ctx);

    // Muerte
    this.muerte.hidden = jugador.vivo;

    this.acumFps += dt;
    this.framesFps++;
    if (this.acumFps > 0.5) {
      this.fps.textContent = this.mostrarFps ? `${Math.round(this.framesFps / this.acumFps)} fps` : '';
      this.acumFps = 0;
      this.framesFps = 0;
    }
  }
}


const FLECHAS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/** Flecha hacia `p` respecto a hacia dónde mira la cámara. */
function flechaHacia(camara: THREE.Camera, p: THREE.Vector3): string {
  const local = p.clone().applyMatrix4(camara.matrixWorldInverse);
  const ang = Math.atan2(local.x, -local.z);
  const i = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
  return FLECHAS[i];
}
