# HelloWorld

A small Python project built to be uneven on purpose. It exists so DeepTest and UntangleIt have something worth pointing at during a demo.

## What is in it

| File | Tests | Purpose in the demo |
|---|---|---|
| `helloworld/greet.py` | Full | Three small functions, every branch tested. Should come up green. |
| `helloworld/names.py` | Thin | Three functions, two tests, one happy path each. `nickname()` has no test at all. Should come up yellow and red. |
| `helloworld/schedule.py` | None | `pick_greeting()`, nested five levels deep with no tests. This is the worst offender, and the function to hand to UntangleIt afterwards. |

## Run it

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
pytest
```

Expected: 10 passed.
