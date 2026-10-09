/**
 * Lógica pura del cable del ODM (sin Three.js ni Rapier, para poder testearla).
 *
 * El cable es una restricción de distancia máxima: solo tira, nunca empuja.
 * Recoger cable = la bobina impone una velocidad radial mínima hacia el ancla
 * y la longitud máxima se acorta hasta la distancia actual. El péndulo aparece
 * solo: gravedad + restricción + inercia conservada.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Si el jugador está más lejos del ancla que `longitud`, lo devuelve a la esfera
 * y elimina la componente de velocidad que se aleja del ancla.
 * Modifica `pos` y `vel`. Devuelve true si el cable quedó tenso.
 */
export function aplicarRestriccion(pos: Vec3, vel: Vec3, ancla: Vec3, longitud: number): boolean {
  const dx = pos.x - ancla.x;
  const dy = pos.y - ancla.y;
  const dz = pos.z - ancla.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= longitud || dist < 1e-6) return false;
  const nx = dx / dist;
  const ny = dy / dist;
  const nz = dz / dist;
  pos.x = ancla.x + nx * longitud;
  pos.y = ancla.y + ny * longitud;
  pos.z = ancla.z + nz * longitud;
  const vr = vel.x * nx + vel.y * ny + vel.z * nz;
  if (vr > 0) {
    vel.x -= nx * vr;
    vel.y -= ny * vr;
    vel.z -= nz * vr;
  }
  return true;
}

/**
 * La bobina recoge cable: garantiza que el jugador se acerca al ancla al menos a
 * `velocidadBobina` m/s (conservando la velocidad tangencial) y acorta la longitud
 * hasta la distancia actual, sin bajar de `longitudMinima`. Devuelve la nueva longitud.
 */
export function aplicarRecogida(
  pos: Vec3,
  vel: Vec3,
  ancla: Vec3,
  longitud: number,
  velocidadBobina: number,
  longitudMinima: number,
): number {
  const dx = pos.x - ancla.x;
  const dy = pos.y - ancla.y;
  const dz = pos.z - ancla.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= longitudMinima || dist < 1e-6) return Math.min(longitud, Math.max(dist, longitudMinima));
  const nx = dx / dist;
  const ny = dy / dist;
  const nz = dz / dist;
  const vr = vel.x * nx + vel.y * ny + vel.z * nz; // >0 = alejándose
  const objetivo = -velocidadBobina;
  if (vr > objetivo) {
    const dv = vr - objetivo;
    vel.x -= nx * dv;
    vel.y -= ny * dv;
    vel.z -= nz * dv;
  }
  return Math.max(longitudMinima, Math.min(longitud, dist));
}

/** Rampa de la bobina: acelera hasta la velocidad máxima de recogida. */
export function acelerarBobina(actual: number, maxima: number, aceleracion: number, dt: number): number {
  return Math.min(maxima, actual + aceleracion * dt);
}

/**
 * Componente tangencial para orbitar el ancla con el impulso de gas: la dirección
 * deseada sin su parte radial (normalizada). Devuelve null si no hay tangente útil.
 */
export function direccionOrbita(pos: Vec3, ancla: Vec3, deseada: Vec3): Vec3 | null {
  const dx = pos.x - ancla.x;
  const dy = pos.y - ancla.y;
  const dz = pos.z - ancla.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return null;
  const nx = dx / dist;
  const ny = dy / dist;
  const nz = dz / dist;
  const d = deseada.x * nx + deseada.y * ny + deseada.z * nz;
  const tx = deseada.x - nx * d;
  const ty = deseada.y - ny * d;
  const tz = deseada.z - nz * d;
  const lt = Math.hypot(tx, ty, tz);
  if (lt < 1e-4) return null;
  return { x: tx / lt, y: ty / lt, z: tz / lt };
}
