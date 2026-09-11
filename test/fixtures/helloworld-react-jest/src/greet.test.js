import { hello, helloMany, shout } from './greet';

describe('hello', () => {
  test('default', () => expect(hello()).toBe('Hello, World!'));
  test('named', () => expect(hello('Jeff')).toBe('Hello, Jeff!'));
  test('empty falls back to World', () => expect(hello('')).toBe('Hello, World!'));
});

describe('helloMany', () => {
  test('empty', () => expect(helloMany([])).toBe('Hello, World!'));
  test('one', () => expect(helloMany(['Jeff'])).toBe('Hello, Jeff!'));
  test('two', () => expect(helloMany(['Jeff', 'Ann'])).toBe('Hello, Jeff and Ann!'));
  test('three', () => expect(helloMany(['Jeff', 'Ann', 'Bob'])).toBe('Hello, Jeff, Ann and Bob!'));
});

test('shout', () => expect(shout('Hello, Jeff!')).toBe('HELLO, JEFF!!!'));
