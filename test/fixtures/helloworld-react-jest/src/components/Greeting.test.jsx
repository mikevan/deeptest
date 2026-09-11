import { render, screen } from '@testing-library/react';
import { Greeting } from './Greeting';

test('Greeting renders the classic greeting', () => {
  render(<Greeting name="Jeff" />);
  expect(screen.getByRole('heading')).toHaveTextContent('Hello, Jeff!');
});
