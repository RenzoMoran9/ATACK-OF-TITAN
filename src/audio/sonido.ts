import * as THREE from 'three';

/**
 * Motor de sonido con Web Audio: efectos sueltos (con distancia y lado respecto a la cámara)
 * y bucles continuos (gas, bobina, viento, ambiente) cuyo volumen se ajusta cada fotograma.
 *
 * Los navegadores no dejan sonar nada hasta el primer toque o tecla: `desbloquear()` se llama
 * entonces y empieza a cargar los archivos de public/sonidos/.
 */

export const SONIDOS = [
  'gancho_disparo', 'gancho_clavar', 'gancho_volver', 'bobina', 'gas', 'gas_golpe', 'viento',
  'tajo', 'corte_carne', 'nuca', 'cuchillas', 'paso_titan', 'galope', 'rugido', 'respiracion',
  'mordisco', 'agarre', 'masticar', 'titan_cae', 'vapor', 'aterrizaje', 'paso', 'recarga',
  'bosque', 'llanura', 'noche', 'brecha', 'bengala', 'campana', 'click', 'golpe',
  'caballo_galope', 'caballo_trote', 'relincho', 'silbido', 'gritos_aldea', 'campana_alarma', 'martillos',
  'aldea', 'esquiva', 'endurecer', 'coraza', 'vitores', 'fogata', 'acorazado', 'hembra', 'bengala_disparo',
] as const;
export type NombreSonido = (typeof SONIDOS)[number];

export interface OpcionesSonido {
  /** Posición en el mundo; sin ella suena «en la cabeza» (sonidos del propio jugador). */
  pos?: THREE.Vector3;
  volumen?: number;
  /** Velocidad de reproducción (1 = normal; menos = más grave). */
  tono?: number;
  /** Variación aleatoria del tono (±), para que no suene repetido. */
  variacion?: number;
  /** Distancia (m) a la que aún suena a volumen completo; más allá cae con la distancia. */
  alcance?: number;
  /** Segundos de espera antes de sonar. */
  retraso?: number;
  /** Lado fijo (-1 izquierda, 1 derecha) para sonidos del jugador. */
  lado?: number;
}

const CLAVE_SILENCIO = 'atack-of-titan-silencio';

export class Sonido {
  private ctx: AudioContext | null = null;
  private maestro: GainNode | null = null;
  private readonly buffers = new Map<NombreSonido, AudioBuffer>();
  private readonly bucles = new Map<NombreSonido, { fuente: AudioBufferSourceNode; gain: GainNode }>();
  private readonly oyente = new THREE.Vector3();
  private readonly derecha = new THREE.Vector3(1, 0, 0);
  private readonly tmp = new THREE.Vector3();
  private cargando = false;
  silenciado: boolean;
  /** Volumen general (0–1). */
  volumen = 0.9;

  constructor(private readonly base = './sonidos/') {
    let s = false;
    try {
      s = localStorage.getItem(CLAVE_SILENCIO) === '1';
    } catch {
      // sin almacenamiento: con sonido
    }
    this.silenciado = s;
    const desbloquear = () => this.desbloquear();
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, desbloquear, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  get listo(): boolean {
    return this.ctx !== null && this.buffers.size > 0;
  }

  /** Crea el contexto de audio (tiene que ser tras un gesto del usuario) y carga los sonidos. */
  desbloquear(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.maestro = this.ctx.createGain();
      this.maestro.gain.value = this.silenciado ? 0 : this.volumen;
      this.maestro.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.cargando) {
      this.cargando = true;
      void this.cargar();
    }
  }

  private async cargar(): Promise<void> {
    const ctx = this.ctx!;
    await Promise.all(
      SONIDOS.map(async (n) => {
        try {
          const r = await fetch(`${this.base}${n}.mp3`);
          if (!r.ok) return;
          const datos = await r.arrayBuffer();
          this.buffers.set(n, await ctx.decodeAudioData(datos));
        } catch {
          // un sonido que falta no rompe el juego
        }
      }),
    );
  }

  alternarSilencio(): boolean {
    this.silenciado = !this.silenciado;
    try {
      localStorage.setItem(CLAVE_SILENCIO, this.silenciado ? '1' : '0');
    } catch {
      // sin almacenamiento
    }
    if (this.ctx && this.maestro) this.maestro.gain.setTargetAtTime(this.silenciado ? 0 : this.volumen, this.ctx.currentTime, 0.05);
    return this.silenciado;
  }

  /** Posición de la cámara y su vector derecho (para el volumen por distancia y el lado). */
  oir(pos: THREE.Vector3, derecha: THREE.Vector3): void {
    this.oyente.copy(pos);
    this.derecha.copy(derecha).normalize();
  }

  distancia(p: THREE.Vector3): number {
    return this.oyente.distanceTo(p);
  }

  tocar(nombre: NombreSonido, o: OpcionesSonido = {}): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(nombre);
    if (!ctx || !buf || !this.maestro || this.silenciado) return;
    let vol = o.volumen ?? 1;
    let pan = o.lado ?? 0;
    if (o.pos) {
      const alcance = o.alcance ?? 15;
      const d = this.oyente.distanceTo(o.pos);
      if (d > alcance * 14) return;
      vol *= alcance / (alcance + Math.max(0, d - alcance));
      const dir = this.tmp.copy(o.pos).sub(this.oyente);
      const l = dir.length();
      if (l > 0.5) pan = THREE.MathUtils.clamp(dir.dot(this.derecha) / l, -1, 1) * 0.75;
    }
    if (vol < 0.015) return;
    const fuente = ctx.createBufferSource();
    fuente.buffer = buf;
    const v = o.variacion ?? 0.06;
    fuente.playbackRate.value = (o.tono ?? 1) * (1 + (Math.random() * 2 - 1) * v);
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1.5, vol);
    let salida: AudioNode = gain;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p);
      salida = p;
    }
    fuente.connect(gain);
    salida.connect(this.maestro);
    fuente.start(ctx.currentTime + (o.retraso ?? 0));
  }

  /** Bucle continuo: se crea al pedir volumen > 0 y se ajusta con suavidad cada fotograma. */
  bucle(nombre: NombreSonido, volumen: number, tono = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.maestro) return;
    let b = this.bucles.get(nombre);
    if (!b) {
      if (volumen <= 0.001) return;
      const buf = this.buffers.get(nombre);
      if (!buf) return;
      const fuente = ctx.createBufferSource();
      fuente.buffer = buf;
      fuente.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      fuente.connect(gain).connect(this.maestro);
      // empezar en un punto al azar: dos bucles iguales no suenan en fase
      fuente.start(0, Math.random() * buf.duration);
      b = { fuente, gain };
      this.bucles.set(nombre, b);
    }
    b.gain.gain.setTargetAtTime(Math.max(0, volumen), ctx.currentTime, 0.08);
    b.fuente.playbackRate.setTargetAtTime(tono, ctx.currentTime, 0.1);
  }

  /** Apaga todos los bucles (pausa, menús). */
  callarBucles(): void {
    if (!this.ctx) return;
    for (const b of this.bucles.values()) b.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }
}
