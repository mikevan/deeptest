/** Simple greetings. Every path here is covered by greet.test.ts. */

export function hello(name = 'World'): string {
  if (!name) {
    name = 'World';
  }
  return `Hello, ${name}!`;
}

export function helloMany(names: string[]): string {
  if (names.length === 0) {
    return hello();
  }
  if (names.length === 1) {
    return hello(names[0]);
  }
  return `Hello, ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}!`;
}

export function shout(text: string): string {
  return text.toUpperCase().replace(/!/g, '!!!');
}
