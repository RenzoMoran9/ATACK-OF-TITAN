import type { EventoJuego, TipoEvento } from './tipos';

type Oyente<T extends TipoEvento> = (e: Extract<EventoJuego, { tipo: T }>) => void;

/**
 * Bus de eventos de juego: los sistemas se enteran de lo que pasa (titán muerto,
 * civil devorado, brecha...) sin conocerse entre sí. Las misiones viven de esto.
 */
export class Eventos {
  private readonly oyentes = new Map<TipoEvento, Set<(e: EventoJuego) => void>>();

  on<T extends TipoEvento>(tipo: T, fn: Oyente<T>): () => void {
    let set = this.oyentes.get(tipo);
    if (!set) {
      set = new Set();
      this.oyentes.set(tipo, set);
    }
    const f = fn as (e: EventoJuego) => void;
    set.add(f);
    return () => set.delete(f);
  }

  emit(e: EventoJuego): void {
    const set = this.oyentes.get(e.tipo);
    if (!set) return;
    for (const fn of [...set]) fn(e);
  }

  /** Quita todos los oyentes (al cambiar de capítulo). */
  limpiar(): void {
    this.oyentes.clear();
  }
}
