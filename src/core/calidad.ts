/**
 * Calidad gráfica. La elige el jugador en la pausa: Automático, o un nivel fijo (Alto, Medio o
 * Bajo). Con un nivel fijo no cambia nada por su cuenta. En Automático la calidad se adapta: si
 * el juego no llega a ~45 imágenes por segundo, baja primero la resolución interna y después el
 * nivel (sin sombras, menos distancia de dibujado); si sobra potencia, sube la resolución hasta
 * el tope del nivel. Nunca sube de nivel por su cuenta (evita que oscile).
 */

export type NivelCalidad = 'alta' | 'media' | 'baja';

/** Lo que elige el jugador: el ajuste automático o un nivel fijo. */
export type ModoGraficos = 'auto' | NivelCalidad;

export const MODOS_GRAFICOS: readonly ModoGraficos[] = ['auto', 'alta', 'media', 'baja'];

export const ETIQUETA_MODO: Readonly<Record<ModoGraficos, string>> = {
  auto: 'Automático',
  alta: 'Alto',
  media: 'Medio',
  baja: 'Bajo',
};

export interface PerfilCalidad {
  etiqueta: string;
  /** Resolución interna (píxeles por punto de pantalla), entre min y max. */
  resolucionMax: number;
  resolucionMin: number;
  sombras: boolean;
  tamanoSombra: number;
  /** Factor sobre la distancia de la niebla (y de dibujado). */
  distancia: number;
  /** Antorchas que dan luz de verdad (cada luz encarece cada píxel). */
  antorchasConLuz: number;
}

export const PERFILES: Record<NivelCalidad, PerfilCalidad> = {
  alta: { etiqueta: 'Alto', resolucionMax: 1.5, resolucionMin: 1, sombras: true, tamanoSombra: 2048, distancia: 1, antorchasConLuz: 8 },
  media: { etiqueta: 'Medio', resolucionMax: 1.1, resolucionMin: 0.7, sombras: true, tamanoSombra: 1024, distancia: 0.6, antorchasConLuz: 4 },
  baja: { etiqueta: 'Bajo', resolucionMax: 0.85, resolucionMin: 0.5, sombras: false, tamanoSombra: 512, distancia: 0.42, antorchasConLuz: 2 },
};

export const ORDEN_NIVELES: NivelCalidad[] = ['alta', 'media', 'baja'];

const CLAVE_MODO = 'atack-of-titan-graficos';

/** El modo que el jugador eligió en este dispositivo (null si nunca lo ha elegido). */
export function modoGuardado(): ModoGraficos | null {
  try {
    const v = localStorage.getItem(CLAVE_MODO);
    return MODOS_GRAFICOS.find((m) => m === v) ?? null;
  } catch {
    return null;
  }
}

/** Guarda el modo elegido. Sin almacenamiento (navegador privado), dura lo que la sesión. */
export function guardarModo(modo: ModoGraficos): void {
  try {
    localStorage.setItem(CLAVE_MODO, modo);
  } catch {
    // sin almacenamiento: la elección solo vale para esta sesión
  }
}

/** Decide el siguiente ajuste a partir de las imágenes por segundo medidas (puro, para tests). */
export function ajustarResolucion(
  fps: number,
  resolucion: number,
  perfil: PerfilCalidad,
): { resolucion: number; bajarNivel: boolean } {
  if (fps < 45) {
    if (resolucion > perfil.resolucionMin + 1e-3) return { resolucion: Math.max(perfil.resolucionMin, resolucion - (fps < 30 ? 0.15 : 0.08)), bajarNivel: false };
    return { resolucion, bajarNivel: true };
  }
  if (fps > 57 && resolucion < perfil.resolucionMax - 1e-3) return { resolucion: Math.min(perfil.resolucionMax, resolucion + 0.05), bajarNivel: false };
  return { resolucion, bajarNivel: false };
}

export class Calidad {
  /** Lo que eligió el jugador. */
  modo: ModoGraficos;
  /** Nivel que se usa ahora (en automático, el que ha elegido el ajuste). */
  nivel: NivelCalidad;
  resolucion: number;
  private tiempo = 0;
  private fotogramas = 0;
  private enfriamiento = 2; // segundos sin medir tras un cambio (la carga de shaders falsea la medida)

  constructor(
    modo: ModoGraficos,
    /** Nivel con el que arranca el modo automático. */
    nivelInicial: NivelCalidad,
    private readonly dpr: number,
    private readonly aplicar: (perfil: PerfilCalidad, resolucion: number, nivelCambiado: boolean) => void,
  ) {
    this.modo = modo;
    this.nivel = modo === 'auto' ? nivelInicial : modo;
    this.resolucion = Math.min(PERFILES[this.nivel].resolucionMax, dpr);
    this.aplicar(PERFILES[this.nivel], this.resolucion, true);
  }

  get perfil(): PerfilCalidad {
    return PERFILES[this.nivel];
  }

  /** El jugador elige automático o un nivel. Un nivel fijo no se mueve por su cuenta. */
  fijar(modo: ModoGraficos): void {
    this.modo = modo;
    this.ponerNivel(modo === 'auto' ? this.nivel : modo);
  }

  private ponerNivel(nivel: NivelCalidad): void {
    const cambia = nivel !== this.nivel;
    this.nivel = nivel;
    this.resolucion = Math.min(PERFILES[nivel].resolucionMax, this.dpr);
    this.enfriamiento = 2;
    this.aplicar(PERFILES[nivel], this.resolucion, cambia);
  }

  /** Llamar cada fotograma con el tiempo real transcurrido (s). Solo hace algo en automático. */
  medir(dtReal: number, activo: boolean): void {
    // en menús, con un nivel fijo o tras una pausa larga no se mide
    if (this.modo !== 'auto' || !activo || dtReal > 0.5) return;
    if (this.enfriamiento > 0) {
      this.enfriamiento -= dtReal;
      return;
    }
    this.tiempo += dtReal;
    this.fotogramas++;
    if (this.tiempo < 1.5) return;
    const fps = this.fotogramas / this.tiempo;
    this.tiempo = 0;
    this.fotogramas = 0;
    const perfil = this.perfil;
    const r = ajustarResolucion(fps, this.resolucion, { ...perfil, resolucionMax: Math.min(perfil.resolucionMax, this.dpr) });
    if (r.bajarNivel) {
      const i = ORDEN_NIVELES.indexOf(this.nivel);
      if (i < ORDEN_NIVELES.length - 1) {
        this.ponerNivel(ORDEN_NIVELES[i + 1]);
        return;
      }
    }
    if (Math.abs(r.resolucion - this.resolucion) > 1e-3) {
      this.resolucion = r.resolucion;
      this.aplicar(perfil, this.resolucion, false);
    }
  }
}
