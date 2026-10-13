import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from '../core/config';
import type { Entrada } from '../core/entrada';
import type { Etiqueta, Fisica } from '../core/fisica';
import { acelerarBobina, aplicarRecogida, aplicarRestriccion, direccionOrbita } from './cuerda';
import type { DepositoGas } from './gas';

/**
 * Equipo de Maniobras Omnidireccionales: dos ganchos independientes que vuelan como
 * proyectiles, se anclan, recogen cable con la bobina y se sueltan conservando la
 * velocidad. Los cables se dibujan finos, brillantes y con holgura cuando no tiran.
 */

export type Lado = 'izq' | 'der';
type Estado = 'listo' | 'volando' | 'anclado' | 'volviendo';

export interface Apunte {
  valido: boolean;
  punto: THREE.Vector3 | null;
  etiqueta: Etiqueta | null;
  /** Objeto móvil (parte de titán) al que pertenece el punto, si lo hay. */
  objeto: THREE.Object3D | null;
  /** Normal de la superficie en el punto (para quedarse de pie en un tronco o una pared). */
  normal?: THREE.Vector3 | null;
}

const PUNTOS_CABLE = 18;

class Gancho {
  estado: Estado = 'listo';
  readonly punta = new THREE.Vector3();
  readonly dir = new THREE.Vector3();
  objetivo: THREE.Vector3 | null = null;
  recorrido = 0;
  distanciaObjetivo = 0;
  readonly ancla = new THREE.Vector3();
  /** Si el ancla está en algo que se mueve (un titán), su punto en coordenadas locales del objeto. */
  objetoAncla: THREE.Object3D | null = null;
  readonly anclaLocal = new THREE.Vector3();
  etiquetaAncla: Etiqueta | null = null;
  longitud = 0;
  /** Lanzado con Q / E: balanceo tipo Spider-Man (no recoge cable; al soltar, impulso). */
  balanceo = false;
  /** Normal de la superficie donde se clavó (null si se desconoce o es un titán). */
  normalAncla: THREE.Vector3 | null = null;
  bobina = 0;
  tenso = false;
  readonly linea: THREE.Line;
  readonly cabeza: THREE.Mesh;

  constructor(readonly lado: Lado, escena: THREE.Scene, material: THREE.LineBasicMaterial, matCabeza: THREE.Material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PUNTOS_CABLE * 3), 3));
    this.linea = new THREE.Line(geo, material);
    this.linea.frustumCulled = false;
    this.linea.visible = false;
    this.cabeza = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 6).rotateX(Math.PI / 2), matCabeza);
    this.cabeza.visible = false;
    escena.add(this.linea, this.cabeza);
  }

  get signo(): -1 | 1 {
    return this.lado === 'izq' ? -1 : 1;
  }
}

export interface ContextoODM {
  pos: THREE.Vector3; // centro del jugador
  vel: THREE.Vector3;
  gas: DepositoGas;
  entrada: Entrada;
  /** Dirección de impulso deseada (WASD respecto a la cámara, o la mirada). */
  dirImpulso: THREE.Vector3;
  /** Espacio cuenta como impulso de gas (no como salto ni freno). */
  impulso: boolean;
}

export class EquipoODM {
  readonly ganchos: [Gancho, Gancho];
  /** El jugador está de pie en un tronco o una pared, sujeto por un cable. */
  pegado = false;
  readonly apuntes: [Apunte, Apunte] = [
    { valido: false, punto: null, etiqueta: null, objeto: null },
    { valido: false, punto: null, etiqueta: null, objeto: null },
  ];
  /** Para el HUD y los chorros de gas. */
  impulsando = false;
  recogiendo = false;
  gasInfinito = false;

  constructor(escena: THREE.Scene, private readonly fisica: Fisica, private readonly excluir: () => RAPIER.Collider) {
    const mat = new THREE.LineBasicMaterial({ color: '#eef3f7', transparent: true, opacity: 0.95 });
    const matCabeza = new THREE.MeshPhongMaterial({ color: '#a7adb3', specular: '#ffffff', shininess: 80 });
    this.ganchos = [new Gancho('izq', escena, mat, matCabeza), new Gancho('der', escena, mat, matCabeza)];
  }

  get anclados(): Gancho[] {
    return this.ganchos.filter((g) => g.estado === 'anclado');
  }

  /**
   * Apuntado asistido (una vez por fotograma): rayo desde la cámara por la mira,
   * con una pequeña separación izquierda/derecha. Si falla, prueba un cono de
   * ~4° y prefiere superficies altas y partes de titán.
   */
  apuntar(origenCam: THREE.Vector3, dirCam: THREE.Vector3, arribaCam: THREE.Vector3, posJugador: THREE.Vector3): void {
    const o = config.odm;
    const alcance = o.alcanceCable;
    const maxRayo = alcance + origenCam.distanceTo(posJugador) + 5;
    this.ganchos.forEach((g, i) => {
      const dir = dirCam.clone().applyAxisAngle(arribaCam, -g.signo * THREE.MathUtils.degToRad(o.separacionGanchosGrados));
      const central = this.fisica.lanzarRayo(origenCam, dir, maxRayo, this.excluir());
      const apunte = this.apuntes[i];
      if (central && central.punto.distanceTo(posJugador) <= alcance) {
        apunte.valido = true;
        apunte.punto = central.punto;
        apunte.etiqueta = central.etiqueta;
        apunte.objeto = central.objeto;
        apunte.normal = central.normal;
        return;
      }
      // Cono de asistencia
      let mejor: { punto: THREE.Vector3; etiqueta: Etiqueta; objeto: THREE.Object3D | null; normal: THREE.Vector3; puntos: number } | null = null;
      const lateral = new THREE.Vector3().crossVectors(dir, arribaCam).normalize();
      const arriba = new THREE.Vector3().crossVectors(lateral, dir).normalize();
      for (const grados of [o.asistenciaGrados * 0.5, o.asistenciaGrados]) {
        const r = Math.tan(THREE.MathUtils.degToRad(grados));
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const d = dir.clone().addScaledVector(lateral, Math.cos(a) * r).addScaledVector(arriba, Math.sin(a) * r).normalize();
          const hit = this.fisica.lanzarRayo(origenCam, d, maxRayo, this.excluir());
          if (!hit || hit.punto.distanceTo(posJugador) > alcance) continue;
          const puntos = hit.punto.y + (hit.etiqueta === 'titan' || hit.etiqueta === 'nuca' ? 40 : 0);
          if (!mejor || puntos > mejor.puntos) mejor = { punto: hit.punto, etiqueta: hit.etiqueta, objeto: hit.objeto, normal: hit.normal, puntos };
        }
      }
      if (mejor) {
        apunte.valido = true;
        apunte.punto = mejor.punto;
        apunte.etiqueta = mejor.etiqueta;
        apunte.objeto = mejor.objeto;
        apunte.normal = mejor.normal;
      } else {
        apunte.valido = false;
        apunte.punto = central ? central.punto : null;
        apunte.etiqueta = central ? central.etiqueta : null;
        apunte.objeto = central ? central.objeto : null;
      }
    });
  }

  /**
   * Q / E: el gancho de ese lado busca solo dónde clavarse, sin apuntar. Lanza un abanico de
   * rayos hacia su costado (algo adelantados y hacia arriba, como en el anime al rodear un
   * tronco) y elige el mejor: a media altura, ni pegado ni al límite del cable; un titán
   * cuenta más. Si no hay nada a ese lado, sale recto hacia el costado y vuelve.
   */
  apunteLateral(lado: Lado, pos: THREE.Vector3, dirMirada: THREE.Vector3): Apunte & { dir: THREE.Vector3 } {
    const alcance = config.odm.alcanceCable;
    const f = new THREE.Vector3(dirMirada.x, 0, dirMirada.z);
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const costado = new THREE.Vector3(-f.z, 0, f.x).multiplyScalar(lado === 'der' ? 1 : -1);
    const arriba = new THREE.Vector3(0, 1, 0);
    let mejor: (Apunte & { dir: THREE.Vector3; coste: number }) | null = null;
    const d = new THREE.Vector3();
    for (const elev of [40, 25, 55, 68, 10]) {
      for (const adelante of [35, 15, 55, 0, 72]) {
        const e = THREE.MathUtils.degToRad(elev);
        const a = THREE.MathUtils.degToRad(adelante);
        d.copy(costado)
          .multiplyScalar(Math.cos(a))
          .addScaledVector(f, Math.sin(a))
          .multiplyScalar(Math.cos(e))
          .addScaledVector(arriba, Math.sin(e))
          .normalize();
        const hit = this.fisica.lanzarRayo(pos, d, alcance, this.excluir());
        if (!hit) continue;
        const dist = hit.punto.distanceTo(pos);
        const titan = hit.etiqueta === 'titan' || hit.etiqueta === 'nuca';
        // el suelo bajo los pies no sirve para girar
        if (dist < 3 || (!titan && hit.punto.y < pos.y + 0.5)) continue;
        // ideal para balancearse: por delante y por encima, a unos 22 m
        const coste = Math.abs(elev - 40) / 30 + Math.abs(adelante - 35) / 40 + Math.abs(dist - 22) / 30 - (titan ? 0.8 : 0);
        if (!mejor || coste < mejor.coste) mejor = { valido: true, punto: hit.punto.clone(), etiqueta: hit.etiqueta, objeto: hit.objeto, normal: hit.normal.clone(), dir: d.clone(), coste };
      }
    }
    if (mejor) return mejor;
    const recto = costado.clone().multiplyScalar(Math.cos(0.5)).addScaledVector(arriba, Math.sin(0.5)).normalize();
    return { valido: false, punto: null, etiqueta: null, objeto: null, dir: recto };
  }

  /** Paso fijo: disparo, vuelo, anclaje, recogida e impulso. Modifica pos/vel del contexto. */
  actualizar(dt: number, c: ContextoODM, salida: (lado: Lado) => THREE.Vector3, dirMirada: THREE.Vector3): void {
    const o = config.odm;
    const gc = config.gas;
    this.recogiendo = false;
    // Clic derecho: los dos ganchos a la vez hacia la mira; Q / E: cada uno por separado
    const teclas: Record<Lado, string> = { izq: 'KeyQ', der: 'KeyE' };
    const ambosPulsado = c.entrada.consumir('Mouse2');
    const ambosMantenido = c.entrada.mantenida('Mouse2');

    this.ganchos.forEach((g, i) => {
      const tecla = teclas[g.lado];
      const porTecla = c.entrada.consumir(tecla);
      const pulsado = porTecla || ambosPulsado;
      const mantenido = c.entrada.mantenida(tecla) || ambosMantenido;

      if (pulsado && g.estado === 'listo' && (this.gasInfinito || c.gas.consumir(gc.costeDisparo))) {
        const origen = salida(g.lado);
        // Q / E solas: el gancho busca su costado; con el clic derecho, va a la mira
        const lateral = porTecla && !ambosPulsado ? this.apunteLateral(g.lado, c.pos, dirMirada) : null;
        const apunte = lateral ?? this.apuntes[i];
        g.punta.copy(origen);
        g.recorrido = 0;
        g.objetoAncla = null;
        g.etiquetaAncla = null;
        if (apunte.valido && apunte.punto) {
          g.objetivo = apunte.punto.clone();
          g.etiquetaAncla = apunte.etiqueta;
          if (apunte.objeto) {
            g.objetoAncla = apunte.objeto;
            g.objetoAncla.updateWorldMatrix(true, false);
            g.anclaLocal.copy(apunte.punto);
            g.objetoAncla.worldToLocal(g.anclaLocal);
          }
          g.dir.copy(g.objetivo).sub(origen).normalize();
          g.distanciaObjetivo = origen.distanceTo(g.objetivo);
        } else {
          g.objetivo = null;
          g.dir.copy(lateral ? lateral.dir : dirMirada);
          g.distanciaObjetivo = o.alcanceCable;
        }
        g.balanceo = lateral !== null;
        g.normalAncla = apunte.valido && !apunte.objeto && apunte.normal ? apunte.normal.clone() : null;
        g.estado = 'volando';
      }

      if ((g.estado === 'volando' || g.estado === 'anclado') && !mantenido) {
        // soltar un balanceo en marcha: salto hacia arriba y adelante, como Spider-Man
        if (g.estado === 'anclado' && g.balanceo && c.vel.length() > 8) {
          const h = new THREE.Vector3(c.vel.x, 0, c.vel.z);
          if (h.lengthSq() > 1) c.vel.addScaledVector(h.normalize(), 3);
          c.vel.y = Math.max(c.vel.y, 0) + 5;
        }
        g.estado = 'volviendo';
      }

      // Ancla sobre algo que se mueve (titán): el punto viaja con el objeto; si desaparece, se suelta.
      if (g.objetoAncla && (g.estado === 'volando' || g.estado === 'anclado')) {
        if (!g.objetoAncla.parent || !g.objetoAncla.visible) {
          g.estado = 'volviendo';
          g.objetoAncla = null;
        } else {
          const p = g.objetoAncla.localToWorld(g.anclaLocal.clone());
          if (g.estado === 'anclado') g.ancla.copy(p);
          if (g.objetivo) g.objetivo.copy(p);
        }
      }

      if (g.estado === 'volando') {
        if (g.objetivo) {
          // el blanco puede moverse: recalcular dirección y distancia restante
          const origen = salida(g.lado);
          g.distanciaObjetivo = origen.distanceTo(g.objetivo);
          g.dir.copy(g.objetivo).sub(origen).normalize();
          g.recorrido = Math.min(g.recorrido, g.distanciaObjetivo);
        }
        g.recorrido = Math.min(g.distanciaObjetivo, g.recorrido + o.velocidadGancho * dt);
        g.punta.copy(salida(g.lado)).addScaledVector(g.dir, g.recorrido);
        if (g.recorrido >= g.distanciaObjetivo) {
          if (g.objetivo) {
            g.estado = 'anclado';
            g.ancla.copy(g.objetivo);
            g.punta.copy(g.objetivo);
            g.longitud = Math.max(o.longitudMinima, c.pos.distanceTo(g.ancla));
            g.bobina = 0;
          } else {
            g.estado = 'volviendo';
          }
        }
      } else if (g.estado === 'volviendo') {
        const origen = salida(g.lado);
        const d = origen.distanceTo(g.punta);
        const avance = o.velocidadGancho * 1.6 * dt;
        if (d <= avance) g.estado = 'listo';
        else g.punta.lerp(origen, avance / d);
      } else if (g.estado === 'anclado') {
        // De pie en la pared: el cable solo sujeta, no recoge ni gasta
        if (this.pegado) {
          g.bobina = 0;
          return;
        }
        // Balanceo (Q / E): el cable no se recoge y haces de péndulo; solo tira para arrancar
        // (desde el suelo o casi parado) hasta coger velocidad con el cable a ≤ 18 m
        if (g.balanceo && c.vel.length() > 12 && g.longitud <= 18) {
          g.bobina = 0;
          return;
        }
        // Mantener = recoger cable (la bobina gasta gas)
        const f = this.gasInfinito ? 1 : c.gas.consumirContinuo(gc.costeRecogidaPorSegundo, dt);
        if (f > 0) {
          g.bobina = acelerarBobina(g.bobina, o.velocidadRecogida, o.aceleracionRecogida, dt);
          g.longitud = aplicarRecogida(c.pos, c.vel, g.ancla, g.longitud, g.bobina * f, o.longitudMinima);
          this.recogiendo = true;
        } else {
          g.bobina = 0;
        }
      }
    });

    // Impulso de gas (Espacio): en la dirección deseada; anclado, añade componente para orbitar
    this.impulsando = false;
    if (c.impulso) {
      const f = this.gasInfinito ? 1 : c.gas.consumirContinuo(gc.costeImpulsoPorSegundo, dt);
      if (f > 0) {
        this.impulsando = true;
        c.vel.addScaledVector(c.dirImpulso, o.fuerzaImpulso * f * dt);
        for (const g of this.anclados) {
          const t = direccionOrbita(c.pos, g.ancla, c.dirImpulso);
          if (t) c.vel.addScaledVector(new THREE.Vector3(t.x, t.y, t.z), o.fuerzaOrbita * f * dt);
          // pequeño tirón hacia el ancla para "tensar"
          const haciaAncla = g.ancla.clone().sub(c.pos).normalize();
          c.vel.addScaledVector(haciaAncla, o.fuerzaImpulso * 0.15 * f * dt);
        }
      }
    }
  }

  /** Restricción de los cables sobre la posición prevista (tras integrar). */
  restringir(pos: THREE.Vector3, vel: THREE.Vector3): void {
    for (let iter = 0; iter < 2; iter++) {
      for (const g of this.anclados) g.tenso = aplicarRestriccion(pos, vel, g.ancla, g.longitud) || g.tenso;
    }
  }

  liberarTodo(): void {
    for (const g of this.ganchos) {
      g.estado = 'listo';
      g.objetoAncla = null;
      g.linea.visible = false;
      g.cabeza.visible = false;
    }
  }

  /** Dibujo: cable recto si tira, con catenaria aproximada si está flojo. */
  dibujar(salida: (lado: Lado) => THREE.Vector3, posJugador: THREE.Vector3): void {
    const a = new THREE.Vector3();
    const medio = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (const g of this.ganchos) {
      const visible = g.estado !== 'listo';
      g.linea.visible = visible;
      g.cabeza.visible = visible;
      if (!visible) continue;
      a.copy(salida(g.lado));
      const b = g.punta;
      const dist = a.distanceTo(b);
      let comba = 0;
      if (g.estado === 'anclado') {
        const holgura = Math.max(0, g.longitud - posJugador.distanceTo(g.ancla));
        comba = Math.min(dist * 0.3, holgura * 0.6);
      } else if (g.estado === 'volviendo') {
        comba = dist * 0.08;
      }
      medio.copy(a).lerp(b, 0.5);
      medio.y -= comba * 2;
      const attr = g.linea.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < PUNTOS_CABLE; k++) {
        const t = k / (PUNTOS_CABLE - 1);
        // Bézier cuadrática a → medio → b
        p.set(0, 0, 0)
          .addScaledVector(a, (1 - t) * (1 - t))
          .addScaledVector(medio, 2 * (1 - t) * t)
          .addScaledVector(b, t * t);
        attr.setXYZ(k, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
      g.cabeza.position.copy(b);
      g.cabeza.lookAt(b.clone().add(g.estado === 'volviendo' ? b.clone().sub(a) : g.dir));
      g.tenso = false;
    }
  }
}
