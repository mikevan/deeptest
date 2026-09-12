import { pickGreeting } from '../schedule';

/** The component nobody tests, wired to the villain. */
export function Schedule({ hour, name }: { hour: number; name: string }) {
  return <p>{pickGreeting(hour, name)}</p>;
}
