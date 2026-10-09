import * as THREE from 'three';
import type { Jugador } from '../player/jugador';

/**
 * HUD mínimo: dos cilindros de gas, retícula con indicador de anclaje válido/fuera de
 * alcance para cada gancho (y su marcador en el mundo), velocidad y avisos.
 */
export class Hud {
  private readonly raiz: HTMLDivElement;
  private readonly rellenos: HTMLDivElement[] = [];
  private readonly textoGas: HTMLSpanElement;
  private readonly indicadores: HTMLDivElement[] = [];
  private readonly marcadores: HTMLDivElement[] = [];
  private readonly velocidad: HTMLDivElement;
  private readonly aviso: HTMLDivElement;
  private readonly fps: HTMLDivElement;
  private readonly inicio: HTMLDivElement;
  private acumFps = 0;
  private framesFps = 0;
  mostrarFps = false;

  constructor(contenedor: HTMLElement, visible: boolean) {
    this.raiz = document.createElement('div');
    this.raiz.className = 'hud';
    this.raiz.style.display = visible ? '' : 'none';
    this.raiz.innerHTML = `
      <div class="hud-gas">
        <div class="cilindro"><div class="relleno"></div></div>
        <div class="cilindro"><div class="relleno"></div></div>
        <span class="etiqueta">GAS <b>100</b></span>
      </div>
      <div class="reticula">
        <div class="indicador izq"></div>
        <div class="punto"></div>
        <div class="indicador der"></div>
      </div>
      <div class="marcador izq"></div>
      <div class="marcador der"></div>
      <div class="hud-velocidad">0 m/s</div>
      <div class="hud-aviso"></div>
      <div class="hud-ayuda">F1 ajustes · R reaparecer</div>
      <div class="hud-fps"></div>`;
    contenedor.appendChild(this.raiz);
    this.raiz.querySelectorAll<HTMLDivElement>('.relleno').forEach((e) => this.rellenos.push(e));
    this.textoGas = this.raiz.querySelector('.etiqueta b')!;
    this.raiz.querySelectorAll<HTMLDivElement>('.indicador').forEach((e) => this.indicadores.push(e));
    this.raiz.querySelectorAll<HTMLDivElement>('.marcador').forEach((e) => this.marcadores.push(e));
    this.velocidad = this.raiz.querySelector('.hud-velocidad')!;
    this.aviso = this.raiz.querySelector('.hud-aviso')!;
    this.fps = this.raiz.querySelector('.hud-fps')!;

    this.inicio = document.createElement('div');
    this.inicio.className = 'inicio';
    this.inicio.innerHTML = `
      <h1>ATACK OF TITAN</h1>
      <p class="sub">Fase 1 · Prototipo de movimiento ODM</p>
      <ul>
        <li><b>Clic izq / Q</b> gancho izquierdo · <b>Clic der / E</b> gancho derecho <i>(mantener = recoger cable, soltar = desenganchar)</i></li>
        <li><b>Espacio</b> impulso de gas · <b>Shift</b> salto en el suelo / freno de emergencia en el aire</li>
        <li><b>WASD</b> mover y ajustar en el aire · <b>Ratón</b> cámara</li>
        <li><b>R</b> reaparecer · <b>F1</b> panel de ajustes · Recarga gas junto a las cajas de la plaza (banderín verde)</li>
      </ul>
      <p class="clic">Haz clic para jugar</p>`;
    contenedor.appendChild(this.inicio);
  }

  mostrarInicio(si: boolean): void {
    this.inicio.style.display = si ? '' : 'none';
  }

  actualizar(dt: number, jugador: Jugador, camara: THREE.Camera, ancho: number, alto: number): void {
    const frac = jugador.gas.fraccion;
    for (const r of this.rellenos) {
      r.style.height = `${(frac * 100).toFixed(1)}%`;
      r.classList.toggle('bajo', frac < 0.2);
    }
    this.textoGas.textContent = Math.round(jugador.gas.nivel).toString();

    jugador.odm.apuntes.forEach((a, i) => {
      const g = jugador.odm.ganchos[i];
      const ind = this.indicadores[i];
      ind.classList.toggle('valido', a.valido);
      ind.classList.toggle('activo', g.estado === 'anclado');
      const m = this.marcadores[i];
      if (a.punto) {
        const p = a.punto.clone().project(camara);
        if (p.z < 1) {
          m.style.display = '';
          m.style.transform = `translate(${((p.x + 1) / 2) * ancho}px, ${((1 - p.y) / 2) * alto}px) rotate(45deg)`;
          m.classList.toggle('valido', a.valido);
        } else m.style.display = 'none';
      } else m.style.display = 'none';
    });

    this.velocidad.textContent = `${jugador.vel.length().toFixed(0)} m/s`;
    this.aviso.textContent = jugador.gas.vacio ? 'Sin gas' : '';

    this.acumFps += dt;
    this.framesFps++;
    if (this.acumFps > 0.5) {
      this.fps.textContent = this.mostrarFps ? `${Math.round(this.framesFps / this.acumFps)} fps` : '';
      this.acumFps = 0;
      this.framesFps = 0;
    }
  }
}
