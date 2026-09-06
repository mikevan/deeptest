def classify(x, y):
    if x > 0:
        if y > 0:
            return "both"
        return "x only"
    elif y > 0 and x == 0:
        return "y only"
    return "neither"

def safe_div(a, b):
    try:
        return a / b
    except ZeroDivisionError:
        return None
    return "dead"
