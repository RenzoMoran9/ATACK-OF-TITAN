# Atack of Titan: pendientes de combate contra titanes y de campaña

Fecha: 2026-10-13. Rama `claude/pensive-ptolemy-x08mbv`, commit `0ccb22f`.

Base: `docs/investigacion/combate.json` y `docs/investigacion/historia.json` (canon del anime), comparados con el código de `src/`.

## 1. Resumen

Los ataques básicos contra titanes ya existen: tajo a la nuca con vapor y evaporación, cortes de tendón y corva, ojos, brazos, liberar manos y mandíbula, cuchillas que se mellan, anclajes que siguen al titán y el giro de Levi. Lo que falta es lo que más se ve en el anime:

1. La esquiva del agarre.
2. Apuntar a partes concretas del titán.
3. La bengala con efecto real sobre el titán.
4. La pasada baja a los tendones.
5. Los jefes canónicos (Acorazado, Hembra, Bestia) y el resto de la campaña.

## 2. Estado de cada ataque

| Ataque | Canon (investigación) | En el código | Prioridad |
| --- | --- | --- | --- |
| Esquiva al agarre | Impulso o cambio de ancla 0,25 s antes del cierre de la mano: cámara lenta ×0,5 durante 0,4 s | No existe. Solo hay aviso (destello en el HUD) y el QTE de cortar dedos o mandíbula | Alta |
| Fijar parte con Tab | Tab recorre los puntos débiles visibles del titán más cercano | No existe. Tab elige soldado para las órdenes | Alta (requiere decisión de tecla) |
| Bengala cegadora | Si estalla a ≤4 m de la cara, ciega al titán 3 s, sin regeneración | Solo visual y sonido (`efectos.bengala`, `player/combate.ts`) | Media |
| Pasada baja a tendones | Volar por debajo de 0,2H y a menos de 3 m de un tendón o corva dispara un tajo corto (0,15 s) | No encontrado como control | Media |
| Giro de Levi | 10 muertes en la nuca y doble toque de F | Implementado con otro disparador: 3 nucas y más de 25 m/s | Decisión de diseño |
| Cegar con tajo a los ojos | Tajo cruzado por delante de la cara | Implementado | Ya está |
| Desarmar hombros y brazos | Tajo al deltoides o codo | Implementado | Ya está |
| Rescate de aliados | Cortar la mano o la mandíbula libera a la víctima | Implementado | Ya está |

## 3. Propuestas detalladas

### 3.1 Esquiva al agarre

- **Qué pide el canon:** si en los 0,25 s anteriores a que cierre la mano impulsas con gas o cambias de ancla, esquivas. Entonces hay cámara lenta ×0,5 durante 0,4 s y el titán pasa a recuperarse.
- **Dónde tocar:** `src/titans/titan.ts` (fase `golpe` de `mantenerAgarre`) y `src/player/jugador.ts` para saber si hubo impulso o cambio de ancla en la última fracción de segundo.
- **Criterio de aceptación:**
  - Impulso dentro de la ventana: no se produce la captura.
  - Impulso fuera de la ventana, o sin gas: se produce la captura.
  - La cámara lenta dura 0,4 s.

### 3.2 Fijar parte con tecla

- **Qué pide el canon:** Tab recorre los puntos débiles visibles del titán más cercano. La asistencia de ganchos y tajo prioriza la parte fijada.
- **Conflicto:** Tab ya elige soldado en las órdenes (`src/npc/escuadron.ts`, README).
- **Opciones:**
  - (a) Usar Tab para partes y mover la elección de soldado a otra tecla.
  - (b) Usar otra tecla para partes (por ejemplo X) y dejar Tab para el escuadrón.
  - (c) En móvil, un botón de partes en la fila superior.
- **Criterio de aceptación:** con una parte fijada, el tajo y los ganchos apuntan a ella aunque la mira esté en otro sitio.

### 3.3 Bengala cegadora

- **Qué pide el canon:** la bengala se dispara a 50 m/s. Si estalla a 4 m o menos de la cara del titán, lo deja ciego 3 s. Esta ceguera no es una herida y no se regenera.
- **Estado:** `src/player/combate.ts` (línea ~224) crea la bengala solo como efecto visual.
- **Dónde tocar:** `src/titans/titan.ts`, con un método de ceguera temporal separado del daño por ojo.
- **Criterio de aceptación:** explosión a 3 m de la cara deja al titán ciego 3 s; a 6 m no; el ojo sigue regenerándose como hasta ahora.

### 3.4 Pasada baja a tendones

- **Qué pide el canon:** si vuelas por debajo de 0,2H de la altura del titán y a menos de 3 m de un tendón o una corva, F lanza un tajo corto (0,15 s, sin carga) hacia esa zona.
- **Estado:** no encontrado. Los tendones se cortan con el tajo normal.
- **Dónde tocar:** `src/player/combate.ts`, detector de pasada baja antes del tajo normal.
- **Criterio de aceptación:** una pasada a 0,15H con el tendón a 2 m corta el tendón; a 0,5H no.

### 3.5 Giro de Levi

- **Estado actual:** clic izquierdo o F mientras recoges cable anclado a un titán, con 3 nucas y más de 25 m/s.
- **Canon:** desbloqueado tras 10 muertes en la nuca, con doble toque de F.
- **Decisión:** mantener el disparador actual o alinearlo con el canon. No es un error.

## 4. Enemigos canónicos que faltan

| Enemigo | Canon (investigación e historia) | Estado |
| --- | --- | --- |
| Titán Acorazado (15 m) | Coraza total; solo son vulnerables las corvas y los codos. Carga final del prólogo y tema del capítulo 9 | No existe |
| Titana Hembra | Endurece la piel. Regenera un solo ojo concentrándose en él. Combate del bosque (capítulo 6) | No existe |
| Titán Bestia | Sin detalles en la investigación revisada | No existe |
| Titán sonriente (13–15 m) | Devora a Carla en el prólogo. Acecha de forma guionizada en una calle lateral | No existe |
| Titán Colosal (60 m) | Escena guionizada: patada a la puerta. Sin combate | Existe (`src/missions/colosal.ts`) |

Para el Acorazado y la Hembra hacen falta comportamientos propios: coraza (solo se puede dañar en las articulaciones indicadas), y en la Hembra, regeneración de un ojo y endurecimiento temporal.

## 5. Campaña

El documento de historia describe 12 capítulos. El código tiene tres identificadores de campaña: `entrenamiento`, `trost` y `libre`.

| Capítulo | Año | Estado |
| --- | --- | --- |
| Prólogo: La caída de Shiganshina | 845 | No (el Colosal está como escena, sin capítulo) |
| 1. Cadetes del 104.º | 847–850 | Parcial: existe `entrenamiento`. No comparado con el tutorial propuesto |
| 2. Trost I. La brecha | 850 | Parcial: `trost` cubre la fase de muralla y la retaguardia |
| 3. Trost II. El depósito | 850 | Parcial: `trost` incluye el depósito en sus pasos |
| 4. Trost III. La roca | 850 | No |
| 5. La 57.ª expedición | — | No |
| 6. El Bosque de Árboles Gigantes | — | No (la Hembra aparece aquí en el canon) |
| 7. Stohess | — | No |
| 8. La noche de Utgard | — | No |
| 9. Sobre la muralla. El Acorazado y el Colosal | — | No |
| 10. La rebelión. Kenny y Orvud | — | No |
| 11. Retorno a Shiganshina | — | No |

El propio documento recomienda, para esta iteración, los capítulos 2 y 3 como una sola misión, más un tutorial mínimo del capítulo 1 que enseñe los cuatro ataques antes de la batalla.

## 6. Titanes y solidez física (pendiente de decisión)

El cuerpo de un titán atraviesa casas, muros y árboles. Solo se controla el centro: un titán de 15 m toca una pared a unos 3,6 m, pero la navegación le deja acercar el centro a unos 1,8 m, así que el cuerpo entra en la casa unos 1,8 m (estimado, no medido con precisión).

Hay dos caminos, y ambos tienen coste:

- **(a)** Aumentar la distancia de navegación de los titanes grandes. Como las calles miden 4 a 8 m y un titán de 15 m necesita unos 7 m de holgura, quedarían atascados en muchas calles.
- **(b)** Bloquear cada segmento del cuerpo contra el mundo. Puede provocar atascos parecidos.

También se puede aceptar el traspaso visual. Hay que decidir cuál prefieres.

## 7. Decisiones pendientes

1. Tecla para fijar partes de un titán (apartado 3.2).
2. Giro de Levi: mantener el disparador actual o alinearlo con el canon (apartado 3.5).
3. Cuerpos de titanes contra casas: (a), (b) o aceptar (apartado 6).
4. Jefes: ¿se implementan Acorazado y Hembra ahora o cuando existan sus capítulos?

## 8. Lo que no se puede juzgar sin jugar

- La ventana del agarre y si la esquiva resulta alcanzable.
- La dificultad en móvil, con apuntado a partes sin selector.
- Los números propuestos en `numerosPropuestos` de `combate.json` (37 parámetros), que deben ajustarse jugando.

Lista para probar:

- Agarre con gas lleno y con gas vacío.
- Bengala a 3, 5 y 7 m de la cara.
- Pasada baja a tendones desde distintas alturas.
- Ojos: cegar con un tajo y con dos.
- Controles táctiles en un teléfono real.

## 9. Orden de trabajo propuesto

1. Esquiva al agarre (apartado 3.1).
2. Bengala con efecto de ceguera (apartado 3.3).
3. Pasada baja a tendones (apartado 3.4).
4. Fijar partes, cuando decidas la tecla (apartado 3.2).
5. Solidez de los titanes contra el mundo, cuando decidas la opción (apartado 6).
6. Acorazado y Hembra, cuando haya capítulos donde aparezcan.
