import { render, screen } from '@testing-library/svelte';
import { expect, test } from 'vitest';
import Greeting from './Greeting.svelte';

test('Greeting renders the classic greeting', () => {
  render(Greeting, { name: 'Jeff' });
  expect(screen.getByRole('heading')).toHaveTextContent('Hello, Jeff!');
});
