from src.calc import classify, safe_div

def test_both():
    assert classify(1, 1) == "both"

def test_x_only():
    assert classify(1, -1) == "x only"

def test_div():
    assert safe_div(4, 2) == 2
    assert safe_div(1, 0) is None
