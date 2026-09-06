const { classify, safeDiv } = require('../src/calc');

describe('classify', () => {
  test('both', () => {
    expect(classify(1, 1)).toBe('both');
  });
  test('x only', () => {
    expect(classify(1, -1)).toBe('x only');
  });
});

test('safeDiv', () => {
  expect(safeDiv(4, 2)).toBe(2);
  expect(safeDiv(1, 0)).toBeNull();
});
