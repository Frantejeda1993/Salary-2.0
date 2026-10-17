/**
 * Aritmética idéntica a la de la app vieja (CPython 3.12+).
 *
 * Python tiene dos formas de sumar y el motor viejo usa las dos:
 *   - `a + b` y `x += y`: suma IEEE-754 normal, igual que en JavaScript.
 *   - `sum(iterable)`: desde Python 3.12 usa suma compensada de Neumaier
 *     (Objects/bltinmodule.c, builtin_sum_impl). Da resultados distintos en
 *     los últimos bits: sum([0.1] * 10) == 1.0, mientras que sumar 0.1 diez
 *     veces con + da 0.9999999999999999.
 *
 * Para reproducir el motor viejo bit a bit, cada `sum(...)` de Python se porta
 * como `pySum(...)` y cada `+=` como `+=`. No intercambiar.
 */

/** Réplica de `sum(values)` de CPython 3.12+ para floats (todos los números se tratan como float). */
export function pySum(values: Iterable<number>): number {
  let f = 0;
  let c = 0;
  let first = true;
  for (const x of values) {
    if (first) {
      // sum() empieza con el entero 0; el primer float se suma sin compensación (0 + x == x).
      f = 0 + x;
      first = false;
      continue;
    }
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) {
      c += (f - t) + x;
    } else {
      c += (x - t) + f;
    }
    f = t;
  }
  if (c !== 0 && Number.isFinite(c)) {
    f += c;
  }
  return f;
}

/** `max(a, b)` de Python: ante empate devuelve el primero (relevante solo para -0.0). */
export function pyMax(a: number, b: number): number {
  return b > a ? b : a;
}

/** `min(a, b)` de Python: ante empate devuelve el primero. */
export function pyMin(a: number, b: number): number {
  return b < a ? b : a;
}

/** Comparación de strings como Python (por punto de código; idéntica a UTF-16 para ASCII). */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
