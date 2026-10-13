import type { Entrada } from '../core/entrada';

/**
 * Controles táctiles (móvil y tableta). No hay lógica de juego aquí: cada control pulsa o
 * suelta los mismos códigos que el teclado y el ratón en `Entrada`, así el juego no distingue.
 *
 * - Mitad izquierda: joystick que aparece donde pones el dedo (WASD); al fondo, corre (Shift).
 * - Mitad derecha: arrastrar gira la cámara. Los botones de acción también la giran si
 *   arrastras sin soltarlos (apuntar mientras recoges cable).
 * - Botones: GANCHOS (clic der), TAJO (clic izq), SALTO/GAS (Espacio), Q / E, y arriba
 *   cuchillas, linterna, mapa, recoger, órdenes, pausa y pantalla completa.
 */

export interface AccionesTactil {
  pausa: () => void;
  pantallaCompleta: () => void;
}

const RADIO = 56; // px del joystick
const SENSIBILIDAD = 1.7; // píxel de dedo → píxel de ratón

export function esDispositivoTactil(forzar: boolean): boolean {
  if (forzar) return true;
  const grueso = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const fino = window.matchMedia?.('(any-pointer: fine)').matches ?? false;
  return grueso || (navigator.maxTouchPoints > 0 && !fino);
}

export class ControlesTactiles {
  readonly raiz: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly pomo: HTMLDivElement;
  private readonly ordenes: HTMLDivElement;
  private joy: { id: number; x: number; y: number } | null = null;
  private readonly mirando = new Map<number, { x: number; y: number }>();
  private readonly teclasJoy = new Set<string>();

  constructor(private readonly entrada: Entrada, acciones: AccionesTactil) {
    document.body.classList.add('tactil');
    const r = (this.raiz = document.createElement('div'));
    r.className = 'tactil-capa';
    r.innerHTML = `
      <div class="tactil-zona"></div>
      <div class="tactil-joy" hidden><div class="pomo"></div></div>
      <div class="tactil-acciones">
        <button class="t-btn grande ganchos" data-k="Mouse2"><span>GANCHOS</span></button>
        <button class="t-btn grande tajo" data-k="Mouse0"><span>TAJO</span></button>
        <button class="t-btn medio salto" data-k="Space"><span>SALTO<br>GAS</span></button>
        <button class="t-btn chico q" data-k="KeyQ"><span>◀</span><small>GANCHO</small></button>
        <button class="t-btn chico e" data-k="KeyE"><span>▶</span><small>GANCHO</small></button>
      </div>
      <div class="tactil-menu">
        <button class="t-btn mini" data-k="KeyR" title="Cambiar cuchillas">⚔<small>R</small></button>
        <button class="t-btn mini" data-k="KeyL" title="Linterna">☀<small>Luz</small></button>
        <button class="t-btn mini" data-k="KeyM" title="Mapa">⌖<small>Mapa</small></button>
        <button class="t-btn mini" data-k="KeyG" title="Recoger equipo / pedir gas">✚<small>G</small></button>
        <button class="t-btn mini" data-accion="ordenes" title="Órdenes al escuadrón">⚑<small>Órdenes</small></button>
        <button class="t-btn mini" data-k="KeyN" title="Sonido">♪<small>Sonido</small></button>
        <button class="t-btn mini" data-accion="pantalla" title="Pantalla completa">⛶<small>Pantalla</small></button>
        <button class="t-btn mini" data-accion="pausa" title="Pausa">❚❚<small>Pausa</small></button>
      </div>
      <div class="tactil-ordenes" hidden>
        <button class="t-btn" data-k="Digit1">1 Seguidme</button>
        <button class="t-btn" data-k="Digit2">2 Atacad</button>
        <button class="t-btn" data-k="Digit3">3 Civiles</button>
        <button class="t-btn" data-k="Digit4">4 Retirada</button>
        <button class="t-btn" data-k="Digit5">5 Esperad</button>
        <button class="t-btn" data-k="Digit6">6 Id allí</button>
        <button class="t-btn" data-k="Digit7">7 A ese titán</button>
        <button class="t-btn" data-k="Digit8">8 Explorad</button>
        <button class="t-btn" data-k="Tab">A quién mando</button>
      </div>
      <div class="tactil-girar">Gira el móvil: se juega en horizontal</div>`;
    document.body.appendChild(r);
    this.base = r.querySelector('.tactil-joy')!;
    this.pomo = r.querySelector('.tactil-joy .pomo')!;
    this.ordenes = r.querySelector('.tactil-ordenes')!;

    const zona = r.querySelector<HTMLDivElement>('.tactil-zona')!;
    zona.addEventListener('pointerdown', (e) => this.empezarZona(e));
    zona.addEventListener('pointermove', (e) => this.moverZona(e));
    zona.addEventListener('pointerup', (e) => this.terminarZona(e));
    zona.addEventListener('pointercancel', (e) => this.terminarZona(e));

    for (const b of r.querySelectorAll<HTMLButtonElement>('.t-btn')) {
      const k = b.dataset.k;
      const accion = b.dataset.accion;
      // los de acción giran la cámara si arrastras sin soltarlos (salvo el gancho izquierdo,
      // que va con el pulgar del joystick)
      const apunta = b.closest('.tactil-acciones') !== null && k !== 'KeyQ';
      let ultimo: { x: number; y: number } | null = null;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('pulsado');
        ultimo = { x: e.clientX, y: e.clientY };
        if (k) this.entrada.presionar(k);
        if (accion === 'pausa') acciones.pausa();
        if (accion === 'pantalla') acciones.pantallaCompleta();
        if (accion === 'ordenes') this.ordenes.hidden = !this.ordenes.hidden;
        if (k?.startsWith('Digit')) this.ordenes.hidden = true;
      });
      b.addEventListener('pointermove', (e) => {
        if (!apunta || !ultimo) return;
        this.entrada.girar((e.clientX - ultimo.x) * SENSIBILIDAD, (e.clientY - ultimo.y) * SENSIBILIDAD);
        ultimo = { x: e.clientX, y: e.clientY };
      });
      const soltar = () => {
        b.classList.remove('pulsado');
        ultimo = null;
        if (k) this.entrada.liberar(k);
      };
      b.addEventListener('pointerup', soltar);
      b.addEventListener('pointercancel', soltar);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  /** Solo durante la partida: en menús y pausa se ocultan para poder tocar los botones de la pantalla. */
  set visible(si: boolean) {
    if (this.raiz.hidden === !si) return;
    this.raiz.hidden = !si;
    if (!si) this.soltarTodo();
  }

  private empezarZona(e: PointerEvent): void {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    this.ordenes.hidden = true;
    if (e.clientX < window.innerWidth * 0.42 && !this.joy) {
      this.joy = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.base.hidden = false;
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.pomo.style.transform = 'translate(-50%, -50%)';
    } else {
      this.mirando.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }

  private moverZona(e: PointerEvent): void {
    if (this.joy && e.pointerId === this.joy.id) {
      let dx = e.clientX - this.joy.x;
      let dy = e.clientY - this.joy.y;
      const d = Math.hypot(dx, dy);
      if (d > RADIO) {
        dx *= RADIO / d;
        dy *= RADIO / d;
      }
      this.pomo.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const nx = dx / RADIO;
      const ny = dy / RADIO;
      const quiero = new Set<string>();
      if (ny < -0.35) quiero.add('KeyW');
      if (ny > 0.35) quiero.add('KeyS');
      if (nx < -0.35) quiero.add('KeyA');
      if (nx > 0.35) quiero.add('KeyD');
      // al fondo del joystick, corre
      if (d > RADIO * 0.95) quiero.add('ShiftLeft');
      this.base.classList.toggle('corre', quiero.has('ShiftLeft'));
      this.ponerTeclasJoy(quiero);
      return;
    }
    const m = this.mirando.get(e.pointerId);
    if (!m) return;
    this.entrada.girar((e.clientX - m.x) * SENSIBILIDAD, (e.clientY - m.y) * SENSIBILIDAD);
    m.x = e.clientX;
    m.y = e.clientY;
  }

  private terminarZona(e: PointerEvent): void {
    if (this.joy && e.pointerId === this.joy.id) {
      this.joy = null;
      this.base.hidden = true;
      this.base.classList.remove('corre');
      this.ponerTeclasJoy(new Set());
    }
    this.mirando.delete(e.pointerId);
  }

  private ponerTeclasJoy(quiero: Set<string>): void {
    for (const k of this.teclasJoy) if (!quiero.has(k)) this.entrada.liberar(k);
    for (const k of quiero) if (!this.teclasJoy.has(k)) this.entrada.presionar(k);
    this.teclasJoy.clear();
    for (const k of quiero) this.teclasJoy.add(k);
  }

  private soltarTodo(): void {
    this.joy = null;
    this.base.hidden = true;
    this.ponerTeclasJoy(new Set());
    this.mirando.clear();
    this.ordenes.hidden = true;
    for (const b of this.raiz.querySelectorAll<HTMLButtonElement>('.t-btn.pulsado')) {
      b.classList.remove('pulsado');
      if (b.dataset.k) this.entrada.liberar(b.dataset.k);
    }
  }
}
