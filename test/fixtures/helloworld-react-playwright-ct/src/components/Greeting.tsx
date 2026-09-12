import { hello, helloMany, shout } from '../greet';

/**
 * The greeting component. Every path through greet.ts is reached from here,
 * because in a component-testing project the page is what gets measured:
 * a function a test calls in Node is not counted, so the tests go through
 * the component.
 */
export function Greeting({ name, names, loud = false }: { name?: string; names?: string[]; loud?: boolean }) {
  const text = names ? helloMany(names) : hello(name);
  return <h1>{loud ? shout(text) : text}</h1>;
}
