
import { hello, helloMany, shout } from './greet';

describe('hello', () => {
  it('default', () => expect(hello()).toBe('Hello, World!'));
  it('named', () => expect(hello('Jeff')).toBe('Hello, Jeff!'));
  it('empty falls back to World', () => expect(hello('')).toBe('Hello, World!'));
});

describe('helloMany', () => {
  it('empty', () => expect(helloMany([])).toBe('Hello, World!'));
  it('one', () => expect(helloMany(['Jeff'])).toBe('Hello, Jeff!'));
  it('two', () => expect(helloMany(['Jeff', 'Ann'])).toBe('Hello, Jeff and Ann!'));
  it('three', () => expect(helloMany(['Jeff', 'Ann', 'Bob'])).toBe('Hello, Jeff, Ann and Bob!'));
});

it('shout', () => expect(shout('Hello, Jeff!')).toBe('HELLO, JEFF!!!'));
