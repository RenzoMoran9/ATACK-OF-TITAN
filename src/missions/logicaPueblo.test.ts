import { describe, expect, it } from 'vitest';
import { LogicaPueblo, titanesAtaque } from './logicaPueblo';

describe('vida de un pueblo', () => {
  it('se libera al matar a todos sus ocupantes', () => {
    const p = new LogicaPueblo('molino', 10, 2);
    expect(p.fase).toBe('tomado');
    expect(p.ocupanteAbatido()).toBe(false);
    expect(p.ocupanteAbatido()).toBe(true);
    expect(p.fase).toBe('liberado');
  });

  it('vuelve la gente, reconstruyen de día y queda en paz', () => {
    const p = new LogicaPueblo('molino', 10, 1);
    p.ocupanteAbatido();
    p.avanzar(2, true, 0, true);
    expect(p.habitantes).toBeGreaterThan(5);
    expect(p.fase).toBe('reconstruyendo');
    for (let h = 0; h < 60; h++) p.avanzar(1, true, 0, true);
    expect(p.etapas).toBe(3);
    expect(p.fase).toBe('enPaz');
  });

  it('de noche no se reconstruye', () => {
    const p = new LogicaPueblo('molino', 10, 1);
    p.ocupanteAbatido();
    p.avanzar(5, false, 0, true);
    expect(p.progreso).toBe(0);
    expect(p.habitantes).toBeGreaterThan(0);
  });

  it('con titanes dentro se pierde obra; si nadie lo defiende, cae', () => {
    const p = new LogicaPueblo('molino', 10, 1);
    p.ocupanteAbatido();
    p.habitantes = 6;
    p.progreso = 0.5;
    expect(p.avanzar(0.5, true, 3, true)).toBeNull();
    expect(p.progreso).toBeLessThan(0.5);
    expect(p.avanzar(5, true, 3, true)).toBe('caido');
    expect(p.fase).toBe('tomado');
    expect(p.ocupantes).toBe(3);
  });

  it('guardar y cargar', () => {
    const p = new LogicaPueblo('dauper', 9, 3);
    p.ocupanteAbatido();
    p.ocupanteAbatido();
    p.ocupanteAbatido();
    p.avanzar(3, true, 0, true);
    const q = new LogicaPueblo('dauper', 9, 3);
    q.cargar(p.guardar());
    expect(q.fase).toBe(p.fase);
    expect(q.habitantes).toBeCloseTo(p.habitantes);
  });

  it('los ataques crecen con los días, hasta 7 titanes', () => {
    expect(titanesAtaque(1)).toBe(2);
    expect(titanesAtaque(6)).toBe(5);
    expect(titanesAtaque(40)).toBe(7);
  });
});

describe('reconstrucción que termina', () => {
  it('con gente, un pueblo liberado se termina en unas pocas horas de día', () => {
    const p = new LogicaPueblo('x', 10, 0);
    p.liberado = true;
    p.habitantes = 5; // poca gente: va al ritmo mínimo
    let horas = 0;
    while (p.progreso < 1 && horas < 24) {
      p.avanzar(0.25, true, 0, true);
      horas += 0.25;
    }
    expect(p.progreso).toBe(1);
    expect(horas).toBeLessThanOrEqual(7);
  });

  it('un ataque no echa abajo las etapas ya terminadas', () => {
    const p = new LogicaPueblo('x', 10, 0);
    p.liberado = true;
    p.habitantes = 30;
    p.progreso = 0.7; // dos etapas hechas y media tercera
    p.avanzar(5, true, 3, false);
    expect(p.etapas).toBe(2);
    expect(p.progreso).toBeCloseTo(2 / 3, 5);
  });
});
