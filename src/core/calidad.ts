/**
 * Calidad gráfica adaptable. En el celular empieza en «media» y, si el juego no llega a ~45
 * imágenes por segundo, baja primero la resolución interna y después el nivel (sin sombras,
 * menos distancia de dibujado). Si sobra potencia, sube la resolución hasta el tope del nivel.
 * Nunca sube de nivel por su cuenta (evita que oscile); el jugador puede elegirlo en la pausa.
 */

export type NivelCalidad = 'alta' | 'media' | 'baja';

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
  alta: { etiqueta: 'Alta', resolucionMax: 1.5, resolucionMin: 1, sombras: true, tamanoSombra: 2048, distancia: 1, antorchasConLuz: 8 },
  media: { etiqueta: 'Media', resolucionMax: 1.1, resolucionMin: 0.7, sombras: true, tamanoSombra: 1024, distancia: 0.6, antorchasConLuz: 4 },
  baja: { etiqueta: 'Fluida', resolucionMax: 0.85, resolucionMin: 0.5, sombras: false, tamanoSombra: 512, distancia: 0.42, antorchasConLuz: 2 },
};

export const ORDEN_NIVELES: NivelCalidad[] = ['alta', 'media', 'baja'];

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
  nivel: NivelCalidad;
  /** Ajuste automático activo (si el jugador elige un nivel a mano, solo se mueve la resolución). */
  auto = true;
  resolucion: number;
  private tiempo = 0;
  private fotogramas = 0;
  private enfriamiento = 2; // segundos sin medir tras un cambio (la carga de shaders falsea la medida)

  constructor(
    inicial: NivelCalidad,
    private readonly dpr: number,
    private readonly aplicar: (perfil: PerfilCalidad, resolucion: number, nivelCambiado: boolean) => void,
  ) {
    this.nivel = inicial;
    this.resolucion = Math.min(PERFILES[inicial].resolucionMax, dpr);
    this.aplicar(PERFILES[inicial], this.resolucion, true);
  }

  get perfil(): PerfilCalidad {
    return PERFILES[this.nivel];
  }

  /** El jugador elige un nivel (desde la pausa). */
  fijar(nivel: NivelCalidad, auto = false): void {
    this.auto = auto;
    const cambia = nivel !== this.nivel;
    this.nivel = nivel;
    this.resolucion = Math.min(PERFILES[nivel].resolucionMax, this.dpr);
    this.enfriamiento = 2;
    this.aplicar(PERFILES[nivel], this.resolucion, cambia);
  }

  /** Llamar cada fotograma con el tiempo real transcurrido (s). */
  medir(dtReal: number, activo: boolean): void {
    if (!activo || dtReal > 0.5) return; // en menús o tras una pausa larga no se mide
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
    if (r.bajarNivel && this.auto) {
      const i = ORDEN_NIVELES.indexOf(this.nivel);
      if (i < ORDEN_NIVELES.length - 1) {
        this.fijar(ORDEN_NIVELES[i + 1], true);
        return;
      }
    }
    if (Math.abs(r.resolucion - this.resolucion) > 1e-3) {
      this.resolucion = r.resolucion;
      this.aplicar(perfil, this.resolucion, false);
    }
  }
}
