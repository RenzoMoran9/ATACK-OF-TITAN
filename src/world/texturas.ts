import * as THREE from 'three';
import { crearRng, type Rng } from '../core/rng';

/**
 * Texturas procedurales dibujadas en canvas (sin archivos externos).
 * Cada función devuelve una textura que se repite; la escala en metros
 * la fija la geometría (UV en metros / tamaño del mosaico).
 */

type Pintor = (ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng) => void;

const cache = new Map<string, THREE.Texture>();

function textura(clave: string, w: number, h: number, pintar: Pintor, color = true): THREE.CanvasTexture {
  const previa = cache.get(clave);
  if (previa) return previa as THREE.CanvasTexture;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  pintar(ctx, w, h, crearRng(clave.length * 7919 + w));
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(clave, tex);
  return tex;
}

/** Moteado fino para que las superficies no parezcan plásticas. */
function grano(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, n: number, alfa: number, claro = '#ffffff', oscuro = '#000000') {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = rng.rango(0, alfa);
    ctx.fillStyle = rng.siguiente() < 0.5 ? claro : oscuro;
    const s = rng.rango(1, 3);
    ctx.fillRect(rng.rango(0, w), rng.rango(0, h), s, s);
  }
  ctx.globalAlpha = 1;
}

/** Manchas suaves que se repiten sin costura (se dibujan también desplazadas un mosaico). */
function manchas(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, n: number, colores: string[], rMin: number, rMax: number, alfa: number) {
  for (let i = 0; i < n; i++) {
    const x = rng.rango(0, w);
    const y = rng.rango(0, h);
    const r = rng.rango(rMin, rMax);
    const c = rng.elegir(colores);
    for (const ox of [-w, 0, w]) {
      for (const oy of [-h, 0, h]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, c);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = alfa;
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  ctx.globalAlpha = 1;
}

const MADERA_OSCURA = '#3a281b';

/**
 * Entramado de madera oscura sobre yeso crema. Un mosaico = un vano de 4 m × 3,2 m (una planta).
 * Variante 'ventana': ventana central con riostras; 'cruz': cruz de San Andrés.
 */
export function texturaEntramado(variante: 'ventana' | 'cruz'): THREE.CanvasTexture {
  return textura(`entramado-${variante}`, 256, 256, (ctx, w, h, rng) => {
    ctx.fillStyle = '#ece1c4';
    ctx.fillRect(0, 0, w, h);
    manchas(ctx, w, h, rng, 14, ['#d9cba8', '#f4ead2', '#d6c7a2'], 20, 70, 0.35);
    grano(ctx, w, h, rng, 2500, 0.12);
    ctx.fillStyle = MADERA_OSCURA;
    ctx.strokeStyle = MADERA_OSCURA;
    ctx.lineCap = 'butt';
    // Soleras y postes en los bordes del vano (al repetirse forman las líneas de planta).
    ctx.fillRect(0, 0, w, 13);
    ctx.fillRect(0, h - 13, w, 13);
    ctx.fillRect(0, 0, 11, h);
    ctx.fillRect(w - 11, 0, 11, h);
    if (variante === 'ventana') {
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(10, h - 12);
      ctx.lineTo(74, 178);
      ctx.moveTo(w - 10, h - 12);
      ctx.lineTo(w - 74, 178);
      ctx.stroke();
      // Antepecho y dintel de la ventana
      ctx.fillRect(60, 172, 136, 10);
      ctx.fillRect(60, 58, 136, 10);
      ctx.fillRect(66, 58, 10, 124);
      ctx.fillRect(w - 76, 58, 10, 124);
      // Vidrio
      const g = ctx.createLinearGradient(76, 68, 180, 172);
      g.addColorStop(0, '#5b6d7c');
      g.addColorStop(0.5, '#2b3540');
      g.addColorStop(1, '#3d4a57');
      ctx.fillStyle = g;
      ctx.fillRect(76, 68, 104, 104);
      ctx.fillStyle = MADERA_OSCURA;
      ctx.fillRect(124, 68, 7, 104);
      ctx.fillRect(76, 112, 104, 6);
      // Contraventanas verdes apagadas
      ctx.fillStyle = '#4c5e45';
      ctx.fillRect(38, 62, 22, 116);
      ctx.fillRect(w - 60, 62, 22, 116);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 66; y < 176; y += 9) {
        ctx.fillRect(40, y, 18, 2);
        ctx.fillRect(w - 58, y, 18, 2);
      }
    } else {
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(8, 10);
      ctx.lineTo(w - 8, h - 10);
      ctx.moveTo(w - 8, 10);
      ctx.lineTo(8, h - 10);
      ctx.stroke();
      ctx.fillRect(0, h / 2 - 5, w, 10);
      ctx.fillRect(w / 2 - 5, 0, 10, h);
    }
    grano(ctx, w, h, rng, 900, 0.18, '#6b4a33', '#140c06');
  });
}

/** Mapa emisivo de las ventanas (de noche se ven luces cálidas). */
export function texturaVentanasNoche(): THREE.CanvasTexture {
  return textura('ventanas-noche', 256, 256, (ctx, w, h, rng) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(128, 130, 10, 128, 120, 80);
    g.addColorStop(0, '#ffcf7a');
    g.addColorStop(1, '#b0571c');
    ctx.fillStyle = g;
    ctx.fillRect(76, 68, 104, 104);
    ctx.fillStyle = '#000';
    ctx.fillRect(124, 68, 7, 104);
    ctx.fillRect(76, 112, 104, 6);
    grano(ctx, w, h, rng, 200, 0.2);
  });
}

/** Sillería gris para zócalos, chimeneas e iglesia. Un mosaico = 2 m × 2 m. */
export function texturaPiedra(): THREE.CanvasTexture {
  return textura('piedra', 256, 256, (ctx, w, h, rng) => {
    ctx.fillStyle = '#6c6a64';
    ctx.fillRect(0, 0, w, h);
    const filas = 5;
    const alto = h / filas;
    for (let f = 0; f < filas; f++) {
      let x = f % 2 === 0 ? 0 : -rng.rango(20, 50);
      while (x < w) {
        const ancho = rng.rango(45, 90);
        const tono = Math.floor(rng.rango(128, 170));
        ctx.fillStyle = `rgb(${tono},${tono - 2},${tono - 8})`;
        ctx.fillRect(x + 2, f * alto + 2, Math.min(ancho, w - x) - 4, alto - 4);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x + 2, f * alto + 2, ancho - 4, 4);
        x += ancho;
      }
    }
    grano(ctx, w, h, rng, 3000, 0.18);
  });
}

/** Teja cerámica roja/anaranjada en hileras. Un mosaico = 2 m × 2 m. `gris` = pizarra para chapiteles. */
export function texturaTejas(gris = false): THREE.CanvasTexture {
  return textura(gris ? 'tejas-gris' : 'tejas', 256, 256, (ctx, w, h, rng) => {
    ctx.fillStyle = gris ? '#3c434c' : '#7a2e18';
    ctx.fillRect(0, 0, w, h);
    const filas = 10;
    const alto = h / filas;
    const anchoTeja = 25.6;
    for (let f = 0; f < filas; f++) {
      const desfase = f % 2 === 0 ? 0 : anchoTeja / 2;
      for (let i = -1; i <= 10; i++) {
        const x = i * anchoTeja + desfase;
        const y = f * alto;
        const base = gris ? rng.rango(70, 100) : rng.rango(0, 1);
        const g = ctx.createLinearGradient(0, y, 0, y + alto);
        if (gris) {
          g.addColorStop(0, `rgb(${base},${base + 8},${base + 18})`);
          g.addColorStop(1, `rgb(${base - 30},${base - 24},${base - 16})`);
        } else {
          const r = 190 + base * 35;
          const gg = 80 + base * 40;
          g.addColorStop(0, `rgb(${r},${gg},${45 + base * 15})`);
          g.addColorStop(1, `rgb(${r - 60},${gg - 35},${30})`);
        }
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x + 1.5, y);
        ctx.lineTo(x + anchoTeja - 1.5, y);
        ctx.lineTo(x + anchoTeja - 1.5, y + alto * 0.7);
        ctx.quadraticCurveTo(x + anchoTeja / 2, y + alto * 1.15, x + 1.5, y + alto * 0.7);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, f * alto, w, 2);
    }
    grano(ctx, w, h, rng, 2500, 0.15);
  });
}

/** Adoquines irregulares. Un mosaico = 3 m × 3 m. */
export function texturaAdoquines(): THREE.CanvasTexture {
  return textura('adoquines', 256, 256, (ctx, w, h, rng) => {
    ctx.fillStyle = '#4a4540';
    ctx.fillRect(0, 0, w, h);
    const n = 14;
    const paso = w / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const cx = (i + 0.5 + (j % 2) * 0.5) * paso + rng.rango(-2, 2);
        const cy = (j + 0.5) * paso + rng.rango(-2, 2);
        const t = rng.rango(110, 160);
        const color = `rgb(${t},${t - 8},${t - 18})`;
        for (const ox of [-w, 0, w]) {
          for (const oy of [-h, 0, h]) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.ellipse(cx + ox, cy + oy, paso * 0.44, paso * 0.4, rng.rango(0, 0.4), 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.beginPath();
            ctx.ellipse(cx + ox - 1.5, cy + oy - 1.5, paso * 0.28, paso * 0.22, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    manchas(ctx, w, h, rng, 10, ['#3b342c', '#8a7a62'], 15, 50, 0.25);
    grano(ctx, w, h, rng, 2000, 0.15);
  });
}

/** Hierba seca y tierra ocre de las llanuras. Un mosaico = 24 m. */
export function texturaHierba(): THREE.CanvasTexture {
  return textura('hierba', 512, 512, (ctx, w, h, rng) => {
    ctx.fillStyle = '#7f8a4f';
    ctx.fillRect(0, 0, w, h);
    manchas(ctx, w, h, rng, 60, ['#9a9455', '#6d7a40', '#a88f5a', '#5f6b39', '#b39a62'], 30, 110, 0.5);
    for (let i = 0; i < 9000; i++) {
      ctx.strokeStyle = rng.elegir(['#5d6a35', '#9fa260', '#7a7d44', '#b0a56a']);
      ctx.globalAlpha = rng.rango(0.2, 0.6);
      const x = rng.rango(0, w);
      const y = rng.rango(0, h);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.rango(-2, 2), y - rng.rango(2, 6));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

/** Tierra apisonada del camino. Un mosaico = 8 m. */
export function texturaCamino(): THREE.CanvasTexture {
  return textura('camino', 256, 256, (ctx, w, h, rng) => {
    ctx.fillStyle = '#9b8058';
    ctx.fillRect(0, 0, w, h);
    manchas(ctx, w, h, rng, 30, ['#7d6644', '#b39769', '#8d7550'], 15, 50, 0.5);
    grano(ctx, w, h, rng, 4000, 0.25);
  });
}

/** Piedra lisa gris-beige de la muralla, casi sin juntas. Un mosaico = 24 m. */
export function texturaMuralla(): THREE.CanvasTexture {
  return textura('muralla', 512, 512, (ctx, w, h, rng) => {
    ctx.fillStyle = '#bdb4a2';
    ctx.fillRect(0, 0, w, h);
    manchas(ctx, w, h, rng, 30, ['#c6beac', '#b3aa98', '#c2b9a7'], 60, 180, 0.1);
    // Juntas apenas insinuadas de grandes sillares
    ctx.strokeStyle = 'rgba(80,72,60,0.07)';
    ctx.lineWidth = 2;
    for (let y = 0; y <= h; y += 256) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (const [x, y] of [[128, 0], [384, 256]]) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 256);
      ctx.stroke();
    }
    // Chorreones de lluvia muy suaves
    for (let i = 0; i < 40; i++) {
      const x = rng.rango(0, w);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(90,82,70,0)');
      g.addColorStop(rng.rango(0.3, 0.9), 'rgba(90,82,70,0.05)');
      g.addColorStop(1, 'rgba(90,82,70,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, rng.rango(3, 14), h);
    }
    grano(ctx, w, h, rng, 9000, 0.05);
  });
}

/** Corteza rojiza de los árboles gigantes. Un mosaico = 4 m de contorno × 8 m de alto. */
export function texturaCorteza(): THREE.CanvasTexture {
  return textura('corteza', 256, 256, (ctx, w, h, rng) => {
    ctx.fillStyle = '#8c4b33';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) {
      const x = rng.rango(0, w);
      const ancho = rng.rango(2, 9);
      ctx.strokeStyle = rng.elegir(['#5a2c1c', '#6b3624', '#a3613f', '#b06c47', '#7a3d28']);
      ctx.globalAlpha = rng.rango(0.4, 0.9);
      ctx.lineWidth = ancho;
      ctx.beginPath();
      ctx.moveTo(x, -10);
      let y = -10;
      let xx = x;
      while (y < h + 10) {
        y += rng.rango(10, 30);
        xx += rng.rango(-3, 3);
        ctx.lineTo(xx, y);
      }
      ctx.stroke();
      // repetición horizontal sin costura
      ctx.save();
      ctx.translate(x < w / 2 ? w : -w, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    grano(ctx, w, h, rng, 2000, 0.2);
  });
}

/** Suelo oscuro del bosque con musgo y hojarasca. Un mosaico = 20 m. */
export function texturaSueloBosque(): THREE.CanvasTexture {
  return textura('suelo-bosque', 512, 512, (ctx, w, h, rng) => {
    ctx.fillStyle = '#4a4130';
    ctx.fillRect(0, 0, w, h);
    manchas(ctx, w, h, rng, 50, ['#56633e', '#5a4630', '#3e4a2c', '#6a5636'], 25, 90, 0.6);
    grano(ctx, w, h, rng, 9000, 0.3, '#8a7650', '#151008');
  });
}

/** Tablones de madera con flejes de hierro y remaches (puerta de la muralla). Un mosaico = 4 m. */
export function texturaPuerta(): THREE.CanvasTexture {
  return textura('puerta', 256, 256, (ctx, w, h, rng) => {
    const tablas = 6;
    const ancho = w / tablas;
    for (let i = 0; i < tablas; i++) {
      const t = rng.rango(70, 95);
      ctx.fillStyle = `rgb(${t},${t * 0.66},${t * 0.42})`;
      ctx.fillRect(i * ancho, 0, ancho, h);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(i * ancho, 0, 2, h);
      for (let k = 0; k < 10; k++) {
        ctx.fillStyle = 'rgba(30,18,10,0.25)';
        ctx.fillRect(i * ancho + rng.rango(4, ancho - 4), 0, 1.5, h);
      }
    }
    for (const y of [40, 200]) {
      ctx.fillStyle = '#2f3134';
      ctx.fillRect(0, y, w, 22);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(0, y, w, 3);
      ctx.fillStyle = '#18191b';
      for (let x = 10; x < w; x += 28) {
        ctx.beginPath();
        ctx.arc(x, y + 11, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    grano(ctx, w, h, rng, 1500, 0.2);
  });
}

/** Cúmulo grande: blanco arriba, gris azulado en la base. */
export function texturaNube(variante: number): THREE.CanvasTexture {
  return textura(`nube-${variante}`, 512, 256, (ctx, w, h, rng) => {
    ctx.clearRect(0, 0, w, h);
    const bolas = 26;
    for (let i = 0; i < bolas; i++) {
      const t = i / bolas;
      const x = w * 0.15 + rng.rango(0, w * 0.7);
      const r = rng.rango(35, 85) * (1 - Math.abs(x / w - 0.5));
      const y = h * 0.72 - rng.rango(0, h * 0.45) * (1 - Math.abs(x / w - 0.5) * 1.4) - t * 4;
      const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.7, 'rgba(246,248,250,0.95)');
      g.addColorStop(1, 'rgba(240,244,248,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Base plana y sombreada del cúmulo
    ctx.globalCompositeOperation = 'source-atop';
    const g = ctx.createLinearGradient(0, h * 0.35, 0, h * 0.85);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(150,165,185,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fillRect(0, h * 0.8, w, h);
    ctx.globalCompositeOperation = 'source-over';
  });
}

/** Punto blando para partículas (gas, vapor, llamas). */
export function texturaParticula(): THREE.CanvasTexture {
  return textura('particula', 64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Emblema de alas (azul y blanca) para la espalda de la capa. */
export function texturaEmblema(): THREE.CanvasTexture {
  return textura('emblema', 128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const ala = (color: string, dir: number) => {
      ctx.save();
      ctx.translate(w / 2 + dir * 4, h / 2);
      ctx.scale(dir, 1);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#1b1f2a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.quadraticCurveTo(38, -46, 50, -18);
      ctx.lineTo(36, -16);
      ctx.lineTo(46, -2);
      ctx.lineTo(30, 0);
      ctx.lineTo(38, 14);
      ctx.lineTo(20, 14);
      ctx.lineTo(24, 28);
      ctx.quadraticCurveTo(4, 26, 0, 34);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    ala('#f4f4f2', -1);
    ala('#2d4f9a', 1);
  });
}

/**
 * Cara de titán puro: ojos abiertos sin expresión y sonrisa fija exagerada con dientes.
 * Se proyecta sobre un casquete esférico delante de la cabeza.
 */
export function texturaCaraTitan(variante: number): THREE.CanvasTexture {
  return textura(`cara-titan-${variante}`, 512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const ojoY = h * 0.38;
    const sepOjos = variante === 0 ? 92 : 104;
    // Ojos: esclerótica blanca, iris pequeño, mirada fija
    for (const lado of [-1, 1]) {
      const x = cx + lado * sepOjos;
      ctx.fillStyle = 'rgba(120,70,60,0.35)';
      ctx.beginPath();
      ctx.ellipse(x, ojoY + 4, 50, 34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f6f1e8';
      ctx.strokeStyle = '#3b2018';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(x, ojoY, 42, variante === 0 ? 27 : 31, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = variante === 0 ? '#5a4a2c' : '#3d4a3a';
      ctx.beginPath();
      ctx.arc(x + lado * -3, ojoY, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0d0907';
      ctx.beginPath();
      ctx.arc(x + lado * -3, ojoY, 5, 0, Math.PI * 2);
      ctx.fill();
      // párpado superior marcado
      ctx.strokeStyle = 'rgba(70,35,25,0.8)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(x, ojoY - 6, 46, 32, 0, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    // Nariz
    ctx.strokeStyle = 'rgba(120,60,45,0.7)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - 6, h * 0.45);
    ctx.quadraticCurveTo(cx - 22, h * 0.56, cx - 12, h * 0.585);
    ctx.quadraticCurveTo(cx, h * 0.6, cx + 14, h * 0.585);
    ctx.stroke();
    // Sonrisa enorme: labios oscuros, hilera de dientes
    const bocaY = h * 0.69;
    const anchoBoca = variante === 0 ? 190 : 210;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - anchoBoca, bocaY - 52);
    ctx.quadraticCurveTo(cx, bocaY + 20, cx + anchoBoca, bocaY - 52);
    ctx.quadraticCurveTo(cx, bocaY + 92, cx - anchoBoca, bocaY - 52);
    ctx.closePath();
    ctx.fillStyle = '#5a1a14';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = '#f3ecd9';
    ctx.beginPath();
    ctx.moveTo(cx - anchoBoca, bocaY - 52);
    ctx.quadraticCurveTo(cx, bocaY + 20, cx + anchoBoca, bocaY - 52);
    ctx.quadraticCurveTo(cx, bocaY + 80, cx - anchoBoca, bocaY - 52);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,60,40,0.75)';
    ctx.lineWidth = 3;
    for (let i = -9; i <= 9; i++) {
      const x = cx + i * (anchoBoca / 10);
      ctx.beginPath();
      ctx.moveTo(x, bocaY - 60);
      ctx.lineTo(x, bocaY + 70);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - anchoBoca, bocaY - 50);
    ctx.quadraticCurveTo(cx, bocaY + 52, cx + anchoBoca, bocaY - 50);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#4a1712';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(cx - anchoBoca - 6, bocaY - 56);
    ctx.quadraticCurveTo(cx, bocaY + 20, cx + anchoBoca + 6, bocaY - 56);
    ctx.quadraticCurveTo(cx, bocaY + 94, cx - anchoBoca - 6, bocaY - 56);
    ctx.stroke();
    // Pliegues de las mejillas
    ctx.strokeStyle = 'rgba(130,70,55,0.55)';
    ctx.lineWidth = 5;
    for (const lado of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + lado * (anchoBoca - 10), bocaY - 100);
      ctx.quadraticCurveTo(cx + lado * (anchoBoca + 30), bocaY - 60, cx + lado * (anchoBoca + 4), bocaY - 20);
      ctx.stroke();
    }
  });
}
