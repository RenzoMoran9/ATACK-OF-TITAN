// Plugin de Vite: al compilar escribe dist/sw.js a partir de src/pwa/sw.plantilla.js con la
// versión (cambia en cada compilación con cambios) y la lista de archivos que se guardan en el
// dispositivo. Así cada publicación nueva hace saltar el aviso «Nueva versión · Actualizar».
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function listar(dir, base = dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listar(p, base) : [relative(base, p).split(sep).join('/')];
  });
}

export function pwa() {
  let salida = 'dist';
  return {
    name: 'atack-of-titan-pwa',
    apply: 'build',
    configResolved(c) {
      salida = c.build.outDir;
    },
    closeBundle() {
      const archivos = listar(salida).filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      const hash = createHash('sha256');
      for (const f of archivos.sort()) hash.update(f).update(readFileSync(join(salida, f)));
      const version = hash.digest('hex').slice(0, 12);
      const plantilla = readFileSync('src/pwa/sw.plantilla.js', 'utf8');
      const sw = plantilla.replace('__VERSION__', version).replace('__ARCHIVOS__', JSON.stringify(['./', ...archivos.filter((f) => f !== 'index.html')].map((f) => (f === './' ? 'index.html' : f))));
      writeFileSync(join(salida, 'sw.js'), sw);
      writeFileSync(join(salida, 'version.txt'), version + '\n');
    },
  };
}
