import { test, expect } from '@playwright/experimental-ct-react';
import { Greeting } from './Greeting';

test.describe('hello', () => {
  test('default', async ({ mount }) => {
    await expect(await mount(<Greeting />)).toHaveText('Hello, World!');
  });
  test('named', async ({ mount }) => {
    await expect(await mount(<Greeting name="Jeff" />)).toHaveText('Hello, Jeff!');
  });
  test('empty falls back to World', async ({ mount }) => {
    await expect(await mount(<Greeting name="" />)).toHaveText('Hello, World!');
  });
});

test.describe('helloMany', () => {
  test('empty', async ({ mount }) => {
    await expect(await mount(<Greeting names={[]} />)).toHaveText('Hello, World!');
  });
  test('one', async ({ mount }) => {
    await expect(await mount(<Greeting names={['Jeff']} />)).toHaveText('Hello, Jeff!');
  });
  test('two', async ({ mount }) => {
    await expect(await mount(<Greeting names={['Jeff', 'Ann']} />)).toHaveText('Hello, Jeff and Ann!');
  });
  test('three', async ({ mount }) => {
    await expect(await mount(<Greeting names={['A', 'B', 'C']} />)).toHaveText('Hello, A, B and C!');
  });
});

test('shout', async ({ mount }) => {
  await expect(await mount(<Greeting name="Jeff" loud />)).toHaveText('HELLO, JEFF!!!');
});
