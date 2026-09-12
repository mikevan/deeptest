/**
 * Name helpers. These have tests, but only one happy path each.
 * DeepTest should flag the branches the tests never reach.
 */

export function cleanName(raw) {
  let name = raw.trim();
  if (!name) {
    return '';
  }
  if (name === name.toUpperCase() || name === name.toLowerCase()) {
    name = name
      .split(/\s+/)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(' ');
  }
  return name;
}

/** The initials of a full name, e.g. "Jeff Q Public" -> "J.Q.P." */
export function initials(fullName) {
  const parts = fullName.split(/\s+/).filter((p) => p);
  if (parts.length === 0) {
    return '';
  }
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase() + '.';
  }
  return parts.map((p) => p.charAt(0).toUpperCase() + '.').join('');
}

/** Shorten a first name for a casual greeting. */
export function nickname(fullName, maxLen = 8) {
  const parts = fullName.split(/\s+/).filter((p) => p);
  const first = parts.length > 0 ? parts[0] : '';
  if (first.length > maxLen) {
    return first.slice(0, maxLen) + '.';
  }
  return first;
}
