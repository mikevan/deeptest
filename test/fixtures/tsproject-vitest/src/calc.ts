export function classify(x: number, y: number): string {
  if (x > 0) {
    if (y > 0) {
      return 'both';
    }
    return 'x only';
  } else if (y > 0 && x === 0) {
    return 'y only';
  }
  return 'neither';
}

export function safeDiv(a: number, b: number): number | null {
  try {
    if (b === 0) {
      throw new Error('div by zero');
    }
    return a / b;
  } catch (e) {
    return null;
  }
  return 'dead' as never;
}

export const add = (a: number, b: number): number => a + b;
