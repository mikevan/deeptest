from helloworld.names import clean_name, initials


def test_clean_name_trims():
    assert clean_name("  Jeff ") == "Jeff"


def test_initials_two_parts():
    assert initials("Jeff Public") == "J.P."
