import * as THREE from 'three';
import type { Efectos } from '../combat/efectos';
import type { CicloDia } from './cicloDia';
import type { Suministros } from '../combat/suministros';
import type { Mundo } from '../world/mundo';
import type { Entrada } from './entrada';
import type { Eventos } from './eventos';
import type { Fisica } from './fisica';
import type { Navegacion } from './navegacion';
import { nuevoId, type Poblacion } from './poblacion';
import type {
  CivilesAPI,
  EscuadronAPI,
  EstadoTitan,
  GestorTitanesAPI,
  Humano,
  JugadorAPI,
  OpcionesTitan,
  OrdenEscuadron,
  PuntoDebil,
  ResultadoCorte,
  TitanAPI,
  ZonaTitan,
} from './tipos';

/** Tiempo de juego y cámara lenta (p. ej. 0,3 s al cortar una nuca). */
export interface Reloj {
  /** Segundos de juego transcurridos. */
  t: number;
  /** Escala actual del tiempo (1 normal). */
  readonly escala: number;
  camaraLenta(escala: number, segundosReales: number): void;
}

/**
 * Todo lo que un sistema puede necesitar. main.ts lo construye con gestores nulos y
 * luego los sustituye por los reales (así cada sistema se puede probar por separado).
 */
export interface ContextoJuego {
  escena: THREE.Scene;
  camara: THREE.PerspectiveCamera;
  fisica: Fisica;
  nav: Navegacion;
  poblacion: Poblacion;
  eventos: Eventos;
  efectos: Efectos;
  mundo: Mundo;
  entrada: Entrada;
  reloj: Reloj;
  jugador: JugadorAPI;
  titanes: GestorTitanesAPI;
  escuadron: EscuadronAPI;
  civiles: CivilesAPI;
  /** Equipos de soldados caídos y cajas de suministros que se pueden recoger. */
  suministros: Suministros;
  /** Dónde reaparece el jugador si lo devoran (lo mueven las misiones). */
  puntoReaparicion: THREE.Vector3;
  esDeNoche(): boolean;
  /** Hora y día del mundo abierto (el cielo la sigue). */
  ciclo: CicloDia;
  /** Gira la cámara hacia un punto (momentos de historia: el Colosal asomando...). */
  orientarCamara(p: THREE.Vector3): void;
}

// ───────────── Gestores nulos (marcadores hasta conectar el sistema real) ─────────────

/** Titán ficticio inmóvil: sirve para probar misiones sin el sistema de titanes. */
class TitanFicticio implements TitanAPI {
  readonly id = nuevoId();
  readonly anormal: boolean;
  readonly posicion: THREE.Vector3;
  readonly rumbo: number;
  readonly altura: number;
  estado: EstadoTitan = 'deambular';
  vivo = true;
  readonly puntosDebiles: PuntoDebil[] = [];
  readonly objetivo: Humano | null = null;
  constructor(o: OpcionesTitan) {
    this.posicion = o.posicion.clone();
    this.rumbo = o.rumbo ?? 0;
    this.altura = o.altura;
    this.anormal = !!o.anormal;
  }
  cabeza(): THREE.Vector3 {
    return this.posicion.clone().setY(this.altura * 0.85);
  }
  recibirCorte(zona: ZonaTitan, danio: number): ResultadoCorte {
    if (zona === 'nuca' && danio >= 150 + 10 * this.altura) {
      this.vivo = false;
      this.estado = 'muerto';
      return { zona, efecto: 'muerte', danio };
    }
    return { zona, efecto: 'nada', danio };
  }
  distraer(): void {}
}

export class TitanesNulos implements GestorTitanesAPI {
  readonly lista: TitanAPI[] = [];
  congelado = false;
  constructor(private readonly poblacion: Poblacion) {}
  generar(o: OpcionesTitan): TitanAPI {
    const t = new TitanFicticio(o);
    this.lista.push(t);
    this.poblacion.agregarTitan(t);
    return t;
  }
  generarGrupo(n: number, centro: THREE.Vector3, radio: number, alturas: number[]): TitanAPI[] {
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return this.generar({ posicion: centro.clone().add(new THREE.Vector3(Math.cos(a) * radio, 0, Math.sin(a) * radio)), altura: alturas[i % alturas.length] });
    });
  }
  limpiar(): void {
    for (const t of this.lista) this.poblacion.quitarTitan(t);
    this.lista.length = 0;
  }
  actualizar(): void {}
  dibujar(): void {}
}

export class EscuadronNulo implements EscuadronAPI {
  readonly soldados: Humano[] = [];
  orden: OrdenEscuadron = 'seguir';
  readonly seleccion = null;
  crear(): void {}
  ordenar(o: OrdenEscuadron): void {
    this.orden = o;
  }
  cambiarSeleccion(): null {
    return null;
  }
  trabajarEn(): void {}
  info(): null {
    return null;
  }
  limpiar(): void {}
  pedirGas(): null {
    return null;
  }
  donanteGas(): null {
    return null;
  }
  actualizar(): void {}
  dibujar(): void {}
}

export class CivilesNulos implements CivilesAPI {
  readonly lista: Humano[] = [];
  salvados = 0;
  muertos = 0;
  restantes = 0;
  generar(): void {}
  generarAldeanos(): Humano[] {
    return [];
  }
  retirar(): void {}
  evacuar(): void {}
  limpiar(): void {}
  actualizar(): void {}
  dibujar(): void {}
}
