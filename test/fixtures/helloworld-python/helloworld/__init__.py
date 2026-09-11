"""HelloWorld: a small, deliberately uneven demo project for DeepTest and UntangleIt.

The module layout is the point of the project:

- greet.py       clean, simple, fully tested.
- names.py       simple, but the tests are thin (one happy path each).
- schedule.py    one tangled function with no tests at all. This is the villain.
"""

from .greet import hello, hello_many
from .names import clean_name, initials
from .schedule import pick_greeting

__all__ = ["hello", "hello_many", "clean_name", "initials", "pick_greeting"]
