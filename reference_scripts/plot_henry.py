#!/usr/bin/env python3
from pathlib import Path
import re
import math
import matplotlib.pyplot as plt
from matplotlib.ticker import NullLocator


# Looks for C1, C2, C3, C4, C5... directories in the current working directory.
# Searches each one recursively for RASPA output files and extracts Henry constants.

CWD = Path.cwd()
OUTFILE = "henry_constants.png"


def carbon_number(path: Path):
    """
    Accepts names like:
      C1, C2, C3
      nC4, nC5
      C1_alk, C5_alk
    """
    m = re.search(r"(?:^|[_\-])(?:n)?C(\d+)(?:$|[_\-])", path.name, re.IGNORECASE)
    if m:
        return int(m.group(1))

    m = re.search(r"^(?:n)?C(\d+)", path.name, re.IGNORECASE)
    if m:
        return int(m.group(1))

    return None


def latest_output_file(folder: Path):
    candidates = []
    for p in folder.rglob("*"):
        if not p.is_file():
            continue
        name = p.name.lower()
        if (
            name.startswith("output")
            or "output_" in name
            or name.endswith(".out")
            or name.endswith(".log")
        ):
            candidates.append(p)

    if not candidates:
        return None

    return max(candidates, key=lambda p: p.stat().st_mtime)


def extract_henry_constant(text: str):
    """
    Tries to extract Henry constants from common RASPA-ish output lines.

    Handles lines like:
      Henry coefficient: ...
      Henry constant: ...
      Average Henry coefficient: ...
      [mol/kg/Pa], [mol/kg/kPa], etc.

    Returns the first plausible float found on a Henry-containing line.
    """

    patterns = [
        r"Henry\s+(?:coefficient|constant).*?([-+]?\d*\.?\d+(?:[Ee][-+]?\d+)?)",
        r"Average\s+Henry.*?([-+]?\d*\.?\d+(?:[Ee][-+]?\d+)?)",
        r"\bKH\b.*?([-+]?\d*\.?\d+(?:[Ee][-+]?\d+)?)",
    ]

    for line in text.splitlines():
        if "henry" not in line.lower() and "kh" not in line.lower():
            continue

        # Skip uncertainty-only / header-looking lines if possible
        for pat in patterns:
            m = re.search(pat, line, flags=re.IGNORECASE)
            if m:
                val = float(m.group(1))
                if math.isfinite(val):
                    return val, line.strip()

    return None, None


def main():
    data = []

    folders = [p for p in CWD.iterdir() if p.is_dir()]

    for folder in folders:
        n = carbon_number(folder)
        if n is None:
            continue

        out = latest_output_file(folder)
        if out is None:
            print(f"[skip] {folder.name}: no output file found")
            continue

        try:
            text = out.read_text(errors="ignore")
        except Exception as e:
            print(f"[skip] {folder.name}: could not read {out}: {e}")
            continue

        kh, source_line = extract_henry_constant(text)
        if kh is None:
            print(f"[skip] {folder.name}: no Henry constant found in {out}")
            continue

        data.append((n, folder.name, kh, out, source_line))

    if not data:
        raise SystemExit("No Henry constants found. Check folder names and output formatting.")

    data.sort(key=lambda x: x[0])

    print("\nFound Henry constants:")
    for n, name, kh, out, line in data:
        print(f"  C{n:<2}  {kh:.8g}   from {out}")
        print(f"       line: {line}")

    xs = [n for n, _, _, _, _ in data]
    ys = [kh for _, _, kh, _, _ in data]

    fig, ax = plt.subplots(figsize=(7, 5))
    ax.scatter(xs, ys)
    ax.set_xlabel("Carbon number, Cn")
    ax.set_ylabel("Henry constant")
    ax.set_title("Henry constants by alkane carbon number")
    ax.set_xticks(xs, [f"C{n}" for n in xs])

    # Henry constants often grow roughly exponentially with chain length.
    if all(y > 0 for y in ys):
        ax.set_yscale("log")

        # Remove the 2x, 3x, ... minor log ticks entirely. This prevents
        # the tightly and unevenly spaced horizontal grid lines.
        ax.yaxis.set_minor_locator(NullLocator())

    # Draw only the major grid: one horizontal line per power of ten and
    # one vertical line per carbon number.
    ax.grid(False)
    ax.grid(True, which="major", axis="both", alpha=0.3)

    fig.tight_layout()
    fig.savefig(OUTFILE, dpi=300)
    print(f"\nSaved plot: {OUTFILE}")

    plt.show()


if __name__ == "__main__":
    main()
