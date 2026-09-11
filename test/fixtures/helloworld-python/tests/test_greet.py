from helloworld.greet import hello, hello_many, shout


def test_hello_default():
    assert hello() == "Hello, World!"


def test_hello_named():
    assert hello("Jeff") == "Hello, Jeff!"


def test_hello_empty_falls_back_to_world():
    assert hello("") == "Hello, World!"


def test_hello_many_empty():
    assert hello_many([]) == "Hello, World!"


def test_hello_many_one():
    assert hello_many(["Jeff"]) == "Hello, Jeff!"


def test_hello_many_two():
    assert hello_many(["Jeff", "Ann"]) == "Hello, Jeff and Ann!"


def test_hello_many_three():
    assert hello_many(["Jeff", "Ann", "Bob"]) == "Hello, Jeff, Ann and Bob!"


def test_shout():
    assert shout("Hello, Jeff!") == "HELLO, JEFF!!!"
