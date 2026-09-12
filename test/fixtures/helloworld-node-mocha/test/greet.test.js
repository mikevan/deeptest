import assert from 'node:assert/strict';
import { hello, helloMany, shout } from '../src/greet.js';

describe('hello', () => {
  it('default', () => assert.equal(hello(), 'Hello, World!'));
  it('named', () => assert.equal(hello('Jeff'), 'Hello, Jeff!'));
  it('empty falls back to World', () => assert.equal(hello(''), 'Hello, World!'));
});
describe('helloMany', () => {
  it('empty', () => assert.equal(helloMany([]), 'Hello, World!'));
  it('one', () => assert.equal(helloMany(['Jeff']), 'Hello, Jeff!'));
  it('two', () => assert.equal(helloMany(['Jeff', 'Ann']), 'Hello, Jeff and Ann!'));
  it('three', () => assert.equal(helloMany(['A', 'B', 'C']), 'Hello, A, B and C!'));
});
it('shout', () => assert.equal(shout('hi!'), 'HI!!!'));
