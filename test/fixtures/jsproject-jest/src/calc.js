function classify(x, y) {
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

function safeDiv(a, b) {
  try {
    if (b === 0) {
      throw new Error('div by zero');
    }
    return a / b;
  } catch (e) {
    return null;
  }
  return 'dead';
}

module.exports = { classify, safeDiv };
