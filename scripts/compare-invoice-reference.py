"""Compare numeric/English layout anchors without copying the reference into Git.

Usage: python scripts/compare-invoice-reference.py <reference.pdf> <generated.pdf>
Requires pdfplumber. Generate the candidate with the sample's test values first.
This measures geometry; it deliberately does NOT certify pixel identity.
"""
import json
import sys
import pdfplumber

ANCHORS = {"Invoice", "000006", "08/09/2026", "83,058.99", "72,225.21", "72,225.2082"}


def inspect(path):
    with pdfplumber.open(path) as doc:
        if len(doc.pages) != 1:
            raise ValueError("The one-line reference fixture must have exactly one page")
        page = doc.pages[0]
        words = [word for word in page.extract_words() if word["text"] in ANCHORS]
        words.sort(key=lambda word: (word["text"], word["top"], word["x0"]))
        return (page.width, page.height), words


if __name__ == "__main__":
    reference_size, reference = inspect(sys.argv[1])
    candidate_size, candidate = inspect(sys.argv[2])
    if reference_size != candidate_size or reference_size != (612, 792):
        raise ValueError("Page geometry must match the supplied Letter sample")
    if len(reference) != 9 or len(candidate) != len(reference):
        raise ValueError("Expected all nine sample fixture anchors")
    deltas = []
    for expected, actual in zip(reference, candidate):
        if expected["text"] != actual["text"]:
            raise ValueError("Sample fixture values do not match")
        deltas.extend(abs(expected[key] - actual[key]) for key in ("x0", "top"))
    maximum = max(deltas)
    print(json.dumps({"anchors": len(reference), "max_position_delta_pt": round(maximum, 4),
                      "page": "Letter", "pixel_identical_certified": False}))
    if maximum > 0.03:
        raise ValueError("Invoice anchor placement differs from the reference by more than 0.03 pt")
