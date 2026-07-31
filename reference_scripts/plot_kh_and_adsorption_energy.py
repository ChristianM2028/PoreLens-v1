#!/usr/bin/env python3
"""
Extract kH and adsorption energy from alkane Henry-coefficient RASPA outputs.

Expected input layout (under --root):
  C2/Output/System_0/output_*.data
  C3/Output/System_0/output_*.data
  ...

It extracts:
  - Average Henry coefficient [mol/kg/Pa]
  - Average <U_gh>_1-<U_h>_0 in kJ/mol (value in parentheses)

By default, reads C2–C10 subdirectories under this script's folder.

Outputs (default in --root):
  - kh_energy_summary.csv
  - kh_vs_chain_length.png
  - adsorption_energy_vs_chain_length.png
  - kh_vs_chain_length_manuscript.png
  - adsorption_energy_vs_chain_length_manuscript.png
    (black markers, no title, x-axis "Chain length")
"""

import argparse
import csv
import re
import sys
from pathlib import Path


DEFAULT_ROOT = Path(__file__).resolve().parent

# folder name -> (plot label, carbon number)
CHAIN_MAP = {
    "C2": ("C2", 2),
    "C3": ("C3", 3),
    "C4": ("C4", 4),
    "C5": ("C5", 5),
    "C6": ("C6", 6),
    "C7": ("C7", 7),
    "C8": ("C8", 8),
    "C9": ("C9", 9),
    "C10": ("C10", 10),
}

KH_RE = re.compile(
    r"Average Henry coefficient:\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\+/-\s*"
    r"([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\[mol/kg/Pa\]"
)

ENERGY_RE = re.compile(
    r"Average\s+<U_gh>_1-<U_h>_0:\s*"
    r"([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\+/-\s*"
    r"([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\[K\]\s*"
    r"\(\s*"
    r"([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\+/-\s*"
    r"([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*kJ/mol"
)


def find_output_file(molecule_dir):
    # type: (Path) -> Path
    matches = sorted((molecule_dir / "Output" / "System_0").glob("output_*.data"))
    if not matches:
        raise FileNotFoundError("No output_*.data found in {}".format(molecule_dir))
    return matches[-1]


def parse_output_values(output_file):
    # type: (Path) -> dict
    kh_val = None
    kh_err = None
    e_kj = None
    e_kj_err = None
    with open(output_file, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if kh_val is None:
                m = KH_RE.search(line)
                if m:
                    kh_val = float(m.group(1))
                    kh_err = float(m.group(2))
            if e_kj is None:
                m = ENERGY_RE.search(line)
                if m:
                    e_kj = float(m.group(3))
                    e_kj_err = float(m.group(4))
            if kh_val is not None and e_kj is not None:
                break
    if kh_val is None:
        raise ValueError("Could not parse Henry coefficient from {}".format(output_file))
    if e_kj is None:
        raise ValueError("Could not parse adsorption energy from {}".format(output_file))
    return {
        "kh_mol_per_kg_pa": kh_val,
        "kh_err": kh_err,
        "energy_kj_per_mol": e_kj,
        "energy_err": e_kj_err,
    }


def write_csv(rows, csv_path):
    # type: (list, Path) -> None
    fieldnames = [
        "molecule",
        "chain_label",
        "chain_number",
        "kh_mol_per_kg_pa",
        "kh_err",
        "adsorption_energy_kj_per_mol",
        "adsorption_energy_err",
        "output_file",
    ]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def make_plots(rows, kh_png, energy_png):
    # type: (list, Path, Path) -> None
    try:
        import matplotlib.pyplot as plt
        from matplotlib.ticker import NullLocator
    except Exception as exc:
        raise RuntimeError(
            "matplotlib is required for plotting. Install or load it, then rerun."
        ) from exc

    x_labels = [r["chain_label"] for r in rows]
    x = list(range(len(rows)))
    kh = [r["kh_mol_per_kg_pa"] for r in rows]
    kh_err = [r["kh_err"] for r in rows]
    e = [r["adsorption_energy_kj_per_mol"] for r in rows]
    e_err = [r["adsorption_energy_err"] for r in rows]

    plt.figure(figsize=(7, 4.5))
    plt.errorbar(x, kh, yerr=kh_err, fmt="o", capsize=4, linestyle="none")
    plt.xticks(x, x_labels)
    plt.xlabel("Alkane chain length")
    plt.ylabel("kH [mol/kg/Pa]")
    plt.yscale("log")
    plt.title("Henry coefficient vs alkane chain length")
    ax = plt.gca()
    ax.yaxis.set_minor_locator(NullLocator())
    ax.grid(False)
    ax.grid(True, which="major", axis="both", alpha=0.3)
    plt.tight_layout()
    plt.savefig(str(kh_png), dpi=200)
    plt.close()

    plt.figure(figsize=(7, 4.5))
    plt.errorbar(x, e, yerr=e_err, fmt="s", capsize=4, linestyle="none")
    plt.xticks(x, x_labels)
    plt.xlabel("Alkane chain length")
    plt.ylabel("Adsorption energy [kJ/mol]")
    plt.title("Adsorption energy vs alkane chain length")
    ax = plt.gca()
    ax.grid(False)
    ax.grid(True, which="major", axis="both", alpha=0.3)
    plt.tight_layout()
    plt.savefig(str(energy_png), dpi=200)
    plt.close()


def make_manuscript_plots(rows, kh_png, energy_png):
    # type: (list, Path, Path) -> None
    """Publication-style figures: black markers, no title, standard x-axis label."""
    try:
        import matplotlib.pyplot as plt
        from matplotlib.ticker import NullLocator
    except Exception as exc:
        raise RuntimeError(
            "matplotlib is required for plotting. Install or load it, then rerun."
        ) from exc

    x_labels = [r["chain_label"] for r in rows]
    x = list(range(len(rows)))
    kh = [r["kh_mol_per_kg_pa"] for r in rows]
    kh_err = [r["kh_err"] for r in rows]
    e = [r["adsorption_energy_kj_per_mol"] for r in rows]
    e_err = [r["adsorption_energy_err"] for r in rows]

    marker_kw = dict(
        color="black",
        markerfacecolor="black",
        markeredgecolor="black",
        ecolor="black",
        capsize=4,
        linestyle="none",
    )

    plt.figure(figsize=(7, 4.5))
    plt.errorbar(x, kh, yerr=kh_err, fmt="o", markersize=6, **marker_kw)
    plt.xticks(x, x_labels)
    plt.xlabel("Chain length")
    plt.ylabel("Henry's constant [mol/kg/Pa]")
    plt.yscale("log")
    ax = plt.gca()
    ax.yaxis.set_minor_locator(NullLocator())
    ax.grid(False)
    ax.grid(True, which="major", axis="both", alpha=0.3)
    plt.tight_layout()
    plt.savefig(str(kh_png), dpi=200)
    plt.close()

    plt.figure(figsize=(7, 4.5))
    plt.errorbar(x, e, yerr=e_err, fmt="o", markersize=6, **marker_kw)
    plt.xticks(x, x_labels)
    plt.xlabel("Chain length")
    plt.ylabel("Adsorption energy [kJ/mol]")
    ax = plt.gca()
    ax.grid(False)
    ax.grid(True, which="major", axis="both", alpha=0.3)
    plt.tight_layout()
    plt.savefig(str(energy_png), dpi=200)
    plt.close()


def main():
    # type: () -> int
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--root",
        default=str(DEFAULT_ROOT),
        help="Root directory containing C2, C3, ... folders (default: script directory)",
    )
    ap.add_argument(
        "--csv",
        default="kh_energy_summary.csv",
        help="Output CSV file (default: kh_energy_summary.csv under --root)",
    )
    ap.add_argument(
        "--kh-plot",
        default="kh_vs_chain_length.png",
        help="Output kH plot PNG filename (default: kh_vs_chain_length.png under --root)",
    )
    ap.add_argument(
        "--energy-plot",
        default="adsorption_energy_vs_chain_length.png",
        help=(
            "Output adsorption energy plot PNG filename "
            "(default: adsorption_energy_vs_chain_length.png under --root)"
        ),
    )
    ap.add_argument(
        "--kh-plot-manuscript",
        default="kh_vs_chain_length_manuscript.png",
        help="Manuscript-style kH plot (default: kh_vs_chain_length_manuscript.png)",
    )
    ap.add_argument(
        "--energy-plot-manuscript",
        default="adsorption_energy_vs_chain_length_manuscript.png",
        help=(
            "Manuscript-style adsorption energy plot "
            "(default: adsorption_energy_vs_chain_length_manuscript.png)"
        ),
    )
    ap.add_argument(
        "--no-manuscript",
        action="store_true",
        help="Skip manuscript-style plot outputs",
    )
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print("Root does not exist: {}".format(root), file=sys.stderr)
        return 1

    rows = []
    missing = []
    for folder, (chain_label, chain_num) in CHAIN_MAP.items():
        mol_dir = root / folder
        if not mol_dir.is_dir():
            missing.append("{} (folder missing)".format(folder))
            continue
        try:
            output_file = find_output_file(mol_dir)
            vals = parse_output_values(output_file)
        except Exception as exc:
            missing.append("{} ({})".format(folder, exc))
            continue
        rows.append(
            {
                "molecule": folder,
                "chain_label": chain_label,
                "chain_number": chain_num,
                "kh_mol_per_kg_pa": vals["kh_mol_per_kg_pa"],
                "kh_err": vals["kh_err"],
                "adsorption_energy_kj_per_mol": vals["energy_kj_per_mol"],
                "adsorption_energy_err": vals["energy_err"],
                "output_file": str(output_file),
            }
        )

    rows.sort(key=lambda r: r["chain_number"])
    if not rows:
        print("No readable alkane outputs found under {}".format(root), file=sys.stderr)
        return 2

    csv_path = Path(args.csv)
    if not csv_path.is_absolute():
        csv_path = root / csv_path
    kh_png = Path(args.kh_plot)
    if not kh_png.is_absolute():
        kh_png = root / kh_png
    energy_png = Path(args.energy_plot)
    if not energy_png.is_absolute():
        energy_png = root / energy_png
    kh_ms_png = Path(args.kh_plot_manuscript)
    if not kh_ms_png.is_absolute():
        kh_ms_png = root / kh_ms_png
    energy_ms_png = Path(args.energy_plot_manuscript)
    if not energy_ms_png.is_absolute():
        energy_ms_png = root / energy_ms_png

    write_csv(rows, csv_path)
    make_plots(rows, kh_png, energy_png)
    if not args.no_manuscript:
        make_manuscript_plots(rows, kh_ms_png, energy_ms_png)

    print("Parsed {} chain lengths".format(len(rows)))
    print("Wrote CSV: {}".format(csv_path))
    print("Wrote plot: {}".format(kh_png))
    print("Wrote plot: {}".format(energy_png))
    if not args.no_manuscript:
        print("Wrote plot: {}".format(kh_ms_png))
        print("Wrote plot: {}".format(energy_ms_png))
    if missing:
        print("Skipped {} entries:".format(len(missing)), file=sys.stderr)
        for msg in missing:
            print("  - {}".format(msg), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
