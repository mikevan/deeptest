import { cleanName, initials } from '../names';

/** A name tag: the cleaned name and its initials. Thinly tested, like names.ts. */
export function NameTag({ raw }: { raw: string }) {
  const name = cleanName(raw);
  return (
    <p>
      <span data-testid="name">{name}</span> <span data-testid="initials">{initials(name)}</span>
    </p>
  );
}
