"""Name helpers. These have tests, but only one happy path each.

DeepTest should flag the branches the tests never reach."""


def clean_name(raw: str) -> str:
    """Trim whitespace and fix capitalisation."""
    name = raw.strip()
    if not name:
        return ""
    if name.isupper() or name.islower():
        name = name.title()
    return name


def initials(full_name: str) -> str:
    """Return the initials of a full name, e.g. 'Jeff Q Public' -> 'J.Q.P.'"""
    parts = [p for p in full_name.split() if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0][0].upper() + "."
    return "".join(p[0].upper() + "." for p in parts)


def nickname(full_name: str, max_len: int = 8) -> str:
    """Shorten a first name for a casual greeting."""
    first = full_name.split()[0] if full_name.split() else ""
    if len(first) > max_len:
        return first[:max_len] + "."
    return first
