import { hello } from '../greet';

/** The one component. It shows the classic greeting; the villain is not wired in, on purpose. */
export function Greeting({ name }) {
  return <h1>{hello(name)}</h1>;
}
