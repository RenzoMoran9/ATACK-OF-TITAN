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
        return;
      }
      // Cono de asistencia
      let mejor: { punto: THREE.Vector3; etiqueta: Etiqueta; objeto: THREE.Object3D | null; puntos: number } | null = null;
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
          if (!mejor || puntos > mejor.puntos) mejor = { punto: hit.punto, etiqueta: hit.etiqueta, objeto: hit.objeto, puntos };
        }
      }
      if (mejor) {
        apunte.valido = true;
        apunte.punto = mejor.punto;
        apunte.etiqueta = mejor.etiqueta;
        apunte.objeto = mejor.objeto;
      } else {
        apunte.valido = false;
        apunte.punto = central ? central.punto : null;
        apunte.etiqueta = central ? central.etiqueta : null;
        apunte.objeto = central ? central.objeto : null;
      }
    });
  }

  /** Paso fijo: disparo, vuelo, anclaje, recogida e impulso. Modifica pos/vel del contexto. */
  actualizar(dt: number, c: ContextoODM, salida: (lado: Lado) => THREE.Vector3, dirMirada: THREE.Vector3): void {
    const o = config.odm;
    const gc = config.gas;
    this.recogiendo = false;
    const teclas: Record<Lado, string[]> = { izq: ['Mouse0', 'KeyQ'], der: ['Mouse2', 'KeyE'] };

    this.ganchos.forEach((g, i) => {
      const [boton, tecla] = teclas[g.lado];
      const pulsado = c.entrada.consumir(boton) || c.entrada.consumir(tecla);
      const mantenido = c.entrada.mantenida(boton) || c.entrada.mantenida(tecla);

      if (pulsado && g.estado === 'listo' && (this.gasInfinito || c.gas.consumir(gc.costeDisparo))) {
        const origen = salida(g.lado);
        const apunte = this.apuntes[i];
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
          g.dir.copy(dirMirada);
          g.distanciaObjetivo = o.alcanceCable;
        }
        g.estado = 'volando';
      }

      if ((g.estado === 'volando' || g.estado === 'anclado') && !mantenido) g.estado = 'volviendo';

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
