"""Simple greetings. Every path here is covered by tests/test_greet.py."""


def hello(name: str = "World") -> str:
    """Return the classic greeting for one name."""
    if not name:
        name = "World"
    return f"Hello, {name}!"


def hello_many(names: list[str]) -> str:
    """Greet several people in one line."""
    if not names:
        return hello()
    if len(names) == 1:
        return hello(names[0])
    return f"Hello, {', '.join(names[:-1])} and {names[-1]}!"


def shout(text: str) -> str:
    """Make a greeting louder."""
    return text.upper().replace("!", "!!!")
