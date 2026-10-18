/**
 * Música de los asaltos, generada (no hay archivo): un bucle de 16 s a 120 pulsos por minuto en
 * re menor, con tambores graves tipo taiko, un ostinato de cuerdas graves en corcheas y acordes de
 * metales (Rem – Si♭ – Do – La). Se renderiza una vez con un OfflineAudioContext y luego suena en
 * bucle; quien la usa sube y baja su volumen con suavidad.
 */

const BPM = 120;
const COMPASES = 8;
const NEGRA = 60 / BPM;
export const DURACION_MUSICA = COMPASES * 4 * NEGRA;

/** Frecuencia de una nota MIDI. */
export function frecuencia(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// re menor: D2 = 38
const D2 = 38;
/** Acordes (raíz MIDI y tipo) de dos compases cada uno: Rem, Si♭, Do, La. */
const ACORDES: [number, 'm' | 'M'][] = [
  [D2, 'm'],
  [D2 - 4, 'M'],
  [D2 - 2, 'M'],
  [D2 - 5, 'M'],
];
/** Ostinato de cuerdas en corcheas (intervalos sobre la raíz del acorde). */
const OSTINATO = [0, 0, 12, 0, 7, 0, 10, 7];
/** Tambor por corcheas en un compás: 2 = golpe fuerte, 1 = suave, 0 = nada. */
const TAMBOR = [2, 0, 0, 1, 2, 0, 1, 0];
const TAMBOR_FINAL = [2, 0, 1, 1, 2, 1, 2, 2];

export async function generarMusicaAsalto(sampleRate: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(DURACION_MUSICA * sampleRate), sampleRate);
  const salida = ctx.createGain();
  salida.gain.value = 0.8;
  // un poco de compresión para que no sature al juntarse todo
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  salida.connect(comp).connect(ctx.destination);
  const corchea = NEGRA / 2;

  for (let compas = 0; compas < COMPASES; compas++) {
    const [raiz, tipo] = ACORDES[Math.floor(compas / 2) % ACORDES.length];
    const t0 = compas * 4 * NEGRA;
    // tambores
    const patron = compas % 4 === 3 ? TAMBOR_FINAL : TAMBOR;
    patron.forEach((g, i) => {
      if (g) tambor(ctx, salida, t0 + i * corchea, g === 2 ? 1 : 0.5);
    });
    // ostinato de cuerdas graves
    OSTINATO.forEach((iv, i) => cuerda(ctx, salida, t0 + i * corchea, corchea * 0.9, frecuencia(raiz + iv), 0.11));
    // metales: el acorde entero, al empezar cada par de compases
    if (compas % 2 === 0) {
      const tercera = tipo === 'm' ? 3 : 4;
      for (const iv of [12, 12 + tercera, 19, 24]) metal(ctx, salida, t0, 8 * NEGRA, frecuencia(raiz + iv), 0.05);
    }
  }
  return ctx.startRendering();
}

/** Golpe de tambor grave: seno que cae de 110 a 42 Hz, con un chasquido de ruido. */
function tambor(ctx: OfflineAudioContext, destino: AudioNode, t: number, fuerza: number): void {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9 * fuerza, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  o.connect(g).connect(destino);
  o.start(t);
  o.stop(t + 0.6);
  // parche: ruido breve filtrado
  const n = ctx.createBufferSource();
  n.buffer = ruido(ctx, 0.08);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  const gn = ctx.createGain();
  gn.gain.setValueAtTime(0.25 * fuerza, t);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  n.connect(f).connect(gn).connect(destino);
  n.start(t);
}

/** Nota de cuerda grave (dos sierras algo desafinadas por un paso bajo). */
function cuerda(ctx: OfflineAudioContext, destino: AudioNode, t: number, dur: number, f: number, vol: number): void {
  const filtro = ctx.createBiquadFilter();
  filtro.type = 'lowpass';
  filtro.frequency.value = 700;
  filtro.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(vol * 0.5, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  filtro.connect(g).connect(destino);
  for (const det of [-7, 7]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(filtro);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}

/** Acorde de metales: sierra con ataque lento y filtro que se abre. */
function metal(ctx: OfflineAudioContext, destino: AudioNode, t: number, dur: number, f: number, vol: number): void {
  const filtro = ctx.createBiquadFilter();
  filtro.type = 'lowpass';
  filtro.frequency.setValueAtTime(400, t);
  filtro.frequency.linearRampToValueAtTime(1600, t + dur * 0.4);
  filtro.frequency.linearRampToValueAtTime(700, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.5);
  g.gain.setValueAtTime(vol, t + dur - 0.6);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  filtro.connect(g).connect(destino);
  for (const det of [-10, 0, 10]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(filtro);
    o.start(t);
    o.stop(t + dur);
  }
}

function ruido(ctx: OfflineAudioContext, segundos: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.ceil(segundos * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
