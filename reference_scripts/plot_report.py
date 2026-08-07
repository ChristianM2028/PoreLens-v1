#!/usr/bin/env python3
"""
RASPA adsorption plotter with a terminal menu.

Works over SSH / headless sessions. No Tkinter needed.

Modes:
  1) Plot one length-increasing/pure-component parent directory
  2) Plot one mixture directory
  3) Overlay multiple length-increasing/pure-component parent directories
  4) Overlay multiple mixture directories

Pure-component expected structure:
  parent_dir/
    C1*/final_abs_pressure_up or final_abs_fug_up
    C2*/final_abs_pressure_up or final_abs_fug_up
    ...

Pure-component file format:
  x  uptake  error

Optional literature overlay for pure-component modes:
  parent_dir/C1/C1_exp.csv, parent_dir/C2/C2_exp.csv, ...
  CSV columns: pressure/fugacity (kPa), uptake (mmol/g == mol/kg numerically)

Mixture expected structure:
  mix_dir/final_mix_abs_molkg

Mixture file format for n components:
  total_x  partial_x_C1 ... partial_x_Cn  uptake_C1 ... uptake_Cn  composition_C1 ... composition_Cn

For the C1-C5 mixture example, that means 16 columns:
  1 total-x column + 5 partial-x columns + 5 uptake columns + 5 composition columns
"""

from __future__ import annotations

import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

try:
    import matplotlib
    # Use a non-GUI backend so this works on Quest/headless SSH.
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "This script needs matplotlib. Try: python -m pip install matplotlib"
    ) from exc


COMPONENT_COLORS = {
    "C1": "tab:blue",
    "C2": "tab:orange",
    "C3": "tab:green",
    "C4": "tab:red",
    "C5": "tab:purple",
    "C6": "tab:brown",
    "C7": "tab:pink",
    "C8": "tab:gray",
    "C9": "tab:olive",
    "C10": "tab:cyan",
}

LINESTYLES = ["-", "--", ":", "-.", (0, (5, 1)), (0, (3, 1, 1, 1)), (0, (1, 1))]
PURE_FILES = ["final_abs_pressure_up", "final_abs_fug_up"]
MIX_FILE = "final_mix_abs_molkg"
CHAIN_LEGEND_FONTSIZE = 13
DATASET_LEGEND_FONTSIZE = 7.5

SUBSCRIPT_DIGITS = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")

# Publication-oriented defaults: readable at two-column width and embedded fonts in PDF.
matplotlib.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "DejaVu Sans", "Liberation Sans"],
    "font.size": 8.5,
    "axes.labelsize": 9,
    "axes.titlesize": 10,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "legend.fontsize": 7.5,
    "legend.title_fontsize": 7.5,
    "axes.linewidth": 0.8,
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
})


@dataclass
class Series:
    component: str
    x: List[float]
    y: List[float]
    yerr: Optional[List[float]]
    dataset_label: str
    source_file: Path


def natural_component_key(component: str) -> Tuple[int, str]:
    m = re.fullmatch(r"C(\d+)", component)
    if m:
        return (int(m.group(1)), component)
    return (10_000, component)


def format_component_label(component: str) -> str:
    """Format a canonical ``C<n>`` key for display without changing the key."""
    match = re.fullmatch(r"C(\d+)", component)
    if match is None:
        return component
    return f"C{match.group(1).translate(SUBSCRIPT_DIGITS)}"


def component_from_path(path: Path) -> Optional[str]:
    """Infer Cn from path parts like C1, C1_alk, C2-anything, etc."""
    for part in reversed(path.parts):
        m = re.search(r"(?:^|[_\-\s/])C(\d+)(?:$|[_\-\s/])", part, flags=re.IGNORECASE)
        if m:
            return f"C{int(m.group(1))}"
        m = re.search(r"^C(\d+)", part, flags=re.IGNORECASE)
        if m:
            return f"C{int(m.group(1))}"
    return None


def read_numeric_table(path: Path) -> List[List[float]]:
    rows: List[List[float]] = []
    for lineno, raw in enumerate(path.read_text().splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            rows.append([float(x) for x in line.split()])
        except ValueError as exc:
            raise ValueError(f"Could not parse numeric data in {path} line {lineno}: {raw!r}") from exc
    if not rows:
        raise ValueError(f"No numeric rows found in {path}")
    return rows


def load_mixture_literature_series(
    mix_dir_or_file: Path,
    dataset_label: str = "Literature",
) -> List[Series]:
    """
    Load digitized mixture literature data from:
        <mixture_dir>/lit_vals/C1.csv
        <mixture_dir>/lit_vals/C2.csv
        ...

    Each file must contain two numeric columns:
        total bulk pressure/fugacity in kPa, uptake in mol/kg

    Comma-separated or whitespace-separated files are both accepted.
    """
    mix_dir = mix_dir_or_file.parent if mix_dir_or_file.is_file() else mix_dir_or_file
    lit_dir = mix_dir / "lit_vals"
    if not lit_dir.is_dir():
        return []

    series: List[Series] = []
    for path in sorted(lit_dir.glob("C*.csv"), key=lambda p: natural_component_key(p.stem.upper())):
        component = path.stem.upper()
        if not re.fullmatch(r"C\d+", component):
            continue

        rows: List[List[float]] = []
        for lineno, raw in enumerate(path.read_text().splitlines(), start=1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = [x for x in re.split(r"[\s,]+", line) if x]
            if len(parts) < 2:
                continue
            try:
                rows.append([float(parts[0]), float(parts[1])])
            except ValueError as exc:
                raise ValueError(
                    f"Could not parse mixture literature data in {path} line {lineno}: {raw!r}"
                ) from exc

        if not rows:
            print(f"WARNING: no numeric literature rows found in {path}", file=sys.stderr)
            continue

        series.append(
            Series(
                component=component,
                x=[row[0] for row in rows],
                y=[row[1] for row in rows],
                yerr=None,
                dataset_label=dataset_label,
                source_file=path,
            )
        )

    return series


def parse_pure_file(path: Path, component: str, dataset_label: str) -> Series:
    rows = read_numeric_table(path)
    bad = [i for i, row in enumerate(rows, start=1) if len(row) < 2]
    if bad:
        raise ValueError(f"{path} has rows with fewer than 2 columns, e.g. line {bad[0]}")
    x = [row[0] for row in rows]
    y = [row[1] for row in rows]
    yerr = [row[2] for row in rows] if all(len(row) >= 3 for row in rows) else None
    return Series(component=component, x=x, y=y, yerr=yerr, dataset_label=dataset_label, source_file=path)


def find_pure_series(parent: Path, file_name: str, dataset_label: str) -> List[Series]:
    candidates = sorted(parent.rglob(file_name), key=lambda p: (len(p.parts), str(p)))
    grouped: Dict[str, List[Path]] = {}
    for path in candidates:
        try:
            rel = path.relative_to(parent)
        except ValueError:
            rel = path
        component = component_from_path(rel) or component_from_path(path)
        if component:
            grouped.setdefault(component, []).append(path)

    series: List[Series] = []
    warnings: List[str] = []
    for component in sorted(grouped, key=natural_component_key):
        files = grouped[component]
        if len(files) > 1:
            warnings.append(
                f"WARNING: {component}: found {len(files)} matching files; using shortest/first: {files[0]}"
            )
        series.append(parse_pure_file(files[0], component, dataset_label))

    if not series:
        raise FileNotFoundError(
            f"Could not find any {file_name!r} under {parent} in folders/paths containing C1, C2, etc."
        )
    if warnings:
        print("\n".join(warnings), file=sys.stderr)
    return series


def find_literature_series(parent: Path, dataset_label: str = "Literature") -> List[Series]:
    """
    Find literature CSV files named <component>_exp.csv under a pure-component
    parent directory (for example C1/C1_exp.csv, C2/C2_exp.csv, ...).

    Expected CSV columns:
      pressure/fugacity (kPa), uptake (mmol/g == mol/kg numerically)

    Extra columns are ignored. Blank lines and lines beginning with # are allowed.
    """
    candidates = sorted(parent.rglob("*_exp.csv"), key=lambda p: (len(p.parts), str(p)))
    grouped: Dict[str, List[Path]] = {}

    for path in candidates:
        # Prefer the filename (C1_exp.csv), then fall back to the directory path.
        m = re.fullmatch(r"C(\d+)_exp\.csv", path.name, flags=re.IGNORECASE)
        component = f"C{int(m.group(1))}" if m else (component_from_path(path) or component_from_path(path.parent))
        if component:
            grouped.setdefault(component, []).append(path)

    series: List[Series] = []
    warnings: List[str] = []

    for component in sorted(grouped, key=natural_component_key):
        files = grouped[component]
        if len(files) > 1:
            warnings.append(
                f"WARNING: {component}: found {len(files)} literature CSVs; using shortest/first: {files[0]}"
            )

        path = files[0]
        x: List[float] = []
        y: List[float] = []

        for lineno, raw in enumerate(path.read_text().splitlines(), start=1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue

            # Accept comma-separated CSVs, with optional whitespace around values.
            fields = [field.strip() for field in line.split(",")]
            if len(fields) < 2:
                warnings.append(f"WARNING: skipping {path} line {lineno}: need at least 2 CSV columns")
                continue

            try:
                x_val = float(fields[0])
                y_val = float(fields[1])
            except ValueError:
                # This also lets a header row be skipped harmlessly.
                continue

            if math.isfinite(x_val) and math.isfinite(y_val):
                x.append(x_val)
                y.append(y_val)

        if not x:
            warnings.append(f"WARNING: skipping {path}: no valid numeric literature rows")
            continue

        series.append(
            Series(
                component=component,
                x=x,
                y=y,
                yerr=None,
                dataset_label=dataset_label,
                source_file=path,
            )
        )

    if warnings:
        print("\n".join(warnings), file=sys.stderr)

    return series


def add_literature_series(
    all_series: List[Series],
    datasets: Sequence[Tuple[Path, str]],
) -> None:
    """Append available literature CSVs for each selected pure-component parent."""
    multiple_parents = len(datasets) > 1
    found_any = False

    for parent, label in datasets:
        literature_label = f"{label} literature" if multiple_parents else "Literature"
        literature = find_literature_series(parent, dataset_label=literature_label)
        if literature:
            found_any = True
            all_series.extend(literature)

    if not found_any:
        print(
            "No literature CSVs found. Expected files such as C1/C1_exp.csv, C2/C2_exp.csv, ...",
            file=sys.stderr,
        )


def parse_mixture_file(mix_dir_or_file: Path, dataset_label: str, x_mode: str = "partial") -> List[Series]:
    path = mix_dir_or_file / MIX_FILE
    if not path.exists():
        # Allow user to paste path to the file itself.
        if mix_dir_or_file.name == MIX_FILE and mix_dir_or_file.is_file():
            path = mix_dir_or_file
        else:
            raise FileNotFoundError(f"Could not find {MIX_FILE!r} in {mix_dir_or_file}")

    rows = read_numeric_table(path)
    ncols = len(rows[0])
    if any(len(row) != ncols for row in rows):
        raise ValueError(f"{path} has inconsistent column counts")
    if (ncols - 1) % 3 != 0:
        raise ValueError(
            f"{path} has {ncols} columns. Expected 1 + 3*n columns: total, n partial x, n uptake, n composition."
        )

    n = (ncols - 1) // 3
    total_x = [row[0] for row in rows]
    series: List[Series] = []
    for i in range(n):
        component = f"C{i + 1}"
        partial_x = [row[1 + i] for row in rows]
        uptake_y = [row[1 + n + i] for row in rows]
        x = partial_x if x_mode == "partial" else total_x
        series.append(Series(component, x, uptake_y, None, dataset_label, path))
    return series



PRESSURE_FACTORS_FROM_PA = {
    "pa": 1.0,
    "kpa": 1e-3,
    "mpa": 1e-6,
    "bar": 1e-5,
    "mbar": 1e-2,
    "atm": 1.0 / 101325.0,
}

PRESSURE_LABELS = {
    "pa": "Pa",
    "kpa": "kPa",
    "mpa": "MPa",
    "bar": "bar",
    "mbar": "mbar",
    "atm": "atm",
}

UPTAKE_ALIASES = {
    "mol/kg": "mol/kg",
    "mol kg-1": "mol/kg",
    "molkg": "mol/kg",
    "mmol/g": "mmol/g",
    "mmol g-1": "mmol/g",
    "mmolg": "mmol/g",
    "g/kg": "g/kg",
    "g kg-1": "g/kg",
    "gkg": "g/kg",
    "mg/g": "mg/g",
    "mg g-1": "mg/g",
    "mgg": "mg/g",
    "wt%": "wt%",
    "wt": "wt%",
    "weight%": "wt%",
}


def normalize_pressure_unit(raw: str) -> str:
    key = raw.strip().lower()
    if key not in PRESSURE_FACTORS_FROM_PA:
        raise ValueError(
            "Unsupported pressure unit. Choose Pa, kPa, MPa, bar, mbar, or atm."
        )
    return key


def normalize_uptake_unit(raw: str) -> str:
    key = raw.strip().lower().replace("_", " ")
    key = re.sub(r"\s+", " ", key)
    if key not in UPTAKE_ALIASES:
        raise ValueError(
            "Unsupported uptake unit. Choose mol/kg, mmol/g, g/kg, mg/g, or wt%."
        )
    return UPTAKE_ALIASES[key]


def uptake_unit_label(unit: str) -> str:
    labels = {
        "mol/kg": "mol kg$^{-1}$",
        "mmol/g": "mmol g$^{-1}$",
        "g/kg": "g kg$^{-1}$",
        "mg/g": "mg g$^{-1}$",
        "wt%": "wt%",
    }
    return labels[unit]


def convert_pressure_values(values: Sequence[float], output_unit: str) -> List[float]:
    """Simulation x-data are always read as Pa."""
    factor = PRESSURE_FACTORS_FROM_PA[output_unit]
    return [float(v) * factor for v in values]


def convert_literature_pressure_values(
    values: Sequence[float],
    input_unit: str,
    output_unit: str,
) -> List[float]:
    """Convert literature x-values from their stated input unit to the chosen plot unit."""
    in_factor = PRESSURE_FACTORS_FROM_PA[input_unit]
    out_factor = PRESSURE_FACTORS_FROM_PA[output_unit]
    # input value * (Pa per input unit) * (output units per Pa)
    pa_per_input = 1.0 / in_factor
    return [float(v) * pa_per_input * out_factor for v in values]


def convert_uptake_value(value: float, input_unit: str, output_unit: str, molar_mass: Optional[float]) -> float:
    """
    Convert uptake between mol/kg, mmol/g, g/kg, mg/g, and wt%.

    mol/kg and mmol/g are numerically identical.
    g/kg and mg/g are numerically identical.

    wt% is defined in the adsorption-literature convention:
        wt% = 100 * (g adsorbate / g adsorbent)

    Therefore, for q in mol/kg and molar mass M in g/mol:
        wt% = q * M / 10
    """
    value = float(value)

    # Convert input to mol/kg as a common basis when possible.
    if input_unit in {"mol/kg", "mmol/g"}:
        mol_per_kg = value
    elif input_unit in {"g/kg", "mg/g"}:
        if molar_mass is None:
            raise ValueError("Molar mass is required for mass-based ↔ molar uptake conversion.")
        mol_per_kg = value / molar_mass
    elif input_unit == "wt%":
        if molar_mass is None:
            raise ValueError("Molar mass is required for wt% ↔ molar uptake conversion.")
        # Adsorption convention: wt% = 100 * g_adsorbate / g_adsorbent.
        # Thus 1 wt% = 10 g adsorbate per kg adsorbent.
        g_per_kg = value * 10.0
        mol_per_kg = g_per_kg / molar_mass
    else:
        raise ValueError(f"Unsupported input uptake unit: {input_unit}")

    if output_unit in {"mol/kg", "mmol/g"}:
        return mol_per_kg
    if output_unit in {"g/kg", "mg/g"}:
        if molar_mass is None:
            raise ValueError("Molar mass is required for molar ↔ mass-based uptake conversion.")
        return mol_per_kg * molar_mass
    if output_unit == "wt%":
        if molar_mass is None:
            raise ValueError("Molar mass is required for conversion to wt%.")
        g_per_kg = mol_per_kg * molar_mass
        # Adsorption convention: wt% = 100 * g_adsorbate / g_adsorbent.
        return g_per_kg / 10.0
    raise ValueError(f"Unsupported output uptake unit: {output_unit}")


def needs_molar_mass(input_unit: str, output_unit: str) -> bool:
    molar = {"mol/kg", "mmol/g"}
    mass = {"g/kg", "mg/g"}
    if input_unit == output_unit:
        return False
    if input_unit in molar and output_unit in molar:
        return False
    if input_unit in mass and output_unit in mass:
        return False
    return True


def prompt_pressure_unit() -> str:
    while True:
        raw = prompt("Pressure unit to display (Pa/kPa/MPa/bar/mbar/atm)", "kPa")
        try:
            return normalize_pressure_unit(raw)
        except ValueError as exc:
            print(exc)


def prompt_xscale() -> str:
    while True:
        raw = prompt("X-axis scale (log/linear)", "log").strip().lower()
        if raw in {"log", "linear"}:
            return raw
        print("Choose log or linear.")


def prompt_uptake_units(include_literature: bool) -> Tuple[str, Optional[str], str]:
    while True:
        raw_sim = prompt(
            "Units of simulation uptake values (mol/kg, mmol/g, g/kg, mg/g, wt%)",
            "mol/kg",
        )
        raw_lit = None
        if include_literature:
            raw_lit = prompt(
                "Units of literature uptake values (mol/kg, mmol/g, g/kg, mg/g, wt%)",
                raw_sim,
            )
        raw_out = prompt(
            "Uptake units to display (mol/kg, mmol/g, g/kg, mg/g, wt%)",
            raw_sim,
        )

        try:
            sim_unit = normalize_uptake_unit(raw_sim)
            lit_unit = normalize_uptake_unit(raw_lit) if raw_lit is not None else None
            out_unit = normalize_uptake_unit(raw_out)
            return sim_unit, lit_unit, out_unit
        except ValueError as exc:
            print(exc)


def prompt_literature_pressure_unit(default: str = "kPa") -> str:
    while True:
        raw = prompt("Units of literature pressure/fugacity x-values", default)
        try:
            return normalize_pressure_unit(raw)
        except ValueError as exc:
            print(exc)


def prompt_component_molar_masses(components: Sequence[str]) -> Dict[str, float]:
    masses: Dict[str, float] = {}
    print("\nMolar masses are needed for this uptake-unit conversion.")
    for component in sorted(set(components), key=natural_component_key):
        while True:
            raw = prompt(f"Molar mass for {component} (g/mol)")
            try:
                value = float(raw)
                if value <= 0:
                    raise ValueError
                masses[component] = value
                break
            except ValueError:
                print("Enter a positive number.")
    return masses


def transform_series_units(
    all_series: Sequence[Series],
    *,
    pressure_unit: str,
    x_scale: str,
    simulation_uptake_unit: str,
    literature_uptake_unit: Optional[str],
    uptake_output_unit: str,
    literature_pressure_unit: Optional[str] = None,
    literature_labels: Optional[Sequence[str]] = None,
) -> List[Series]:
    """
    Convert all series for plotting.

    Simulation x-values are always treated as Pa.
    Literature x-values use literature_pressure_unit.

    Simulation and literature uptake units may differ and are converted
    independently to uptake_output_unit.
    """
    literature_label_set = set(literature_labels or [])

    # Determine which components actually need molar masses.
    mass_needed_components = set()
    for s in all_series:
        is_literature = s.dataset_label in literature_label_set
        input_unit = literature_uptake_unit if is_literature else simulation_uptake_unit
        if input_unit is None:
            input_unit = simulation_uptake_unit
        if needs_molar_mass(input_unit, uptake_output_unit):
            mass_needed_components.add(s.component)

    molar_masses: Dict[str, float] = {}
    if mass_needed_components:
        molar_masses = prompt_component_molar_masses(
            sorted(mass_needed_components, key=natural_component_key)
        )

    transformed: List[Series] = []
    for s in all_series:
        is_literature = s.dataset_label in literature_label_set

        if is_literature:
            if literature_pressure_unit is None:
                raise ValueError("Literature pressure unit was not supplied.")
            x = convert_literature_pressure_values(
                s.x,
                literature_pressure_unit,
                pressure_unit,
            )
            input_uptake_unit = literature_uptake_unit or simulation_uptake_unit
        else:
            x = convert_pressure_values(s.x, pressure_unit)
            input_uptake_unit = simulation_uptake_unit

        mm = molar_masses.get(s.component)

        y = [
            convert_uptake_value(
                v,
                input_uptake_unit,
                uptake_output_unit,
                mm,
            )
            for v in s.y
        ]

        yerr = None
        if s.yerr is not None:
            yerr = []
            for val, err in zip(s.y, s.yerr):
                upper = convert_uptake_value(
                    val + err,
                    input_uptake_unit,
                    uptake_output_unit,
                    mm,
                )
                lower_input = max(val - err, 0.0)
                lower = convert_uptake_value(
                    lower_input,
                    input_uptake_unit,
                    uptake_output_unit,
                    mm,
                )
                center = convert_uptake_value(
                    val,
                    input_uptake_unit,
                    uptake_output_unit,
                    mm,
                )
                yerr.append(
                    (abs(upper - center) + abs(center - lower)) / 2.0
                )

        transformed.append(
            Series(
                component=s.component,
                x=x,
                y=y,
                yerr=yerr,
                dataset_label=s.dataset_label,
                source_file=s.source_file,
            )
        )

    return transformed


def clean_for_log(series: Series) -> Series:
    if series.yerr is None:
        triples = [(x, y, None) for x, y in zip(series.x, series.y)]
    else:
        triples = list(zip(series.x, series.y, series.yerr))

    kept = [(x, y, e) for x, y, e in triples if x > 0 and math.isfinite(x) and math.isfinite(y)]
    if not kept:
        raise ValueError(f"No positive finite x-values left for {series.component} from {series.source_file}")

    x = [v[0] for v in kept]
    y = [v[1] for v in kept]
    yerr = None if series.yerr is None else [float(v[2]) for v in kept if v[2] is not None]
    return Series(series.component, x, y, yerr, series.dataset_label, series.source_file)


def plot_series(
    all_series: Sequence[Series],
    title: str,
    x_label: str,
    y_label: str,
    output_path: Path,
    show_errorbars: bool = True,
    x_scale: str = "log",
) -> None:
    if not all_series:
        raise ValueError("No series to plot")

    if x_scale == "log":
        cleaned = [clean_for_log(s) for s in all_series]
    else:
        cleaned = list(all_series)

    dataset_labels: List[str] = []
    for s in cleaned:
        if s.dataset_label not in dataset_labels:
            dataset_labels.append(s.dataset_label)
    style_by_dataset = {label: LINESTYLES[i % len(LINESTYLES)] for i, label in enumerate(dataset_labels)}

    components = sorted({s.component for s in cleaned}, key=natural_component_key)
    color_by_component = {c: COMPONENT_COLORS.get(c, f"C{i % 10}") for i, c in enumerate(components)}

    fig, ax = plt.subplots(figsize=(7.1, 4.6), constrained_layout=True)

    for s in sorted(cleaned, key=lambda z: (natural_component_key(z.component), dataset_labels.index(z.dataset_label))):
        color = color_by_component[s.component]
        linestyle = style_by_dataset[s.dataset_label]
        if show_errorbars and s.yerr is not None:
            ax.errorbar(
                s.x,
                s.y,
                yerr=s.yerr,
                color=color,
                linestyle=linestyle,
                marker="o",
                markersize=3.0,
                linewidth=1.5,
                markerfacecolor="white",
                markeredgewidth=0.7,
                capsize=2,
                label="_nolegend_",
            )
        else:
            ax.plot(
                s.x,
                s.y,
                color=color,
                linestyle=linestyle,
                marker="o",
                markersize=3.0,
                linewidth=1.5,
                markerfacecolor="white",
                markeredgewidth=0.7,
                label="_nolegend_",
            )

    ax.set_xscale(x_scale)
    ax.set_xlabel(x_label)
    ax.set_ylabel(y_label)
    # Keep titles in the manuscript caption rather than inside the figure.
    ax.grid(True, which="major", linewidth=0.5, alpha=0.25)
    ax.grid(False, which="minor")
    ax.tick_params(which="both", direction="in", top=True, right=True)

    component_handles = [
        Line2D(
            [0],
            [0],
            color=color_by_component[c],
            lw=2.4,
            linestyle="-",
            label=format_component_label(c),
        )
        for c in components
    ]
    dataset_handles = [
        Line2D([0], [0], color="black", lw=2.2, linestyle=style_by_dataset[label], label=label)
        for label in dataset_labels
    ]

    leg1 = ax.legend(
        handles=component_handles,
        title="Chain",
        loc="upper left",
        framealpha=0.92,
        edgecolor="0.75",
        fontsize=CHAIN_LEGEND_FONTSIZE,
    )
    for label in leg1.get_texts():
        label.set_fontweight("bold")
    ax.add_artist(leg1)
    ax.legend(
        handles=dataset_handles,
        title="Dataset",
        loc="lower right",
        framealpha=0.92,
        edgecolor="0.75",
        fontsize=DATASET_LEGEND_FONTSIZE,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=600, bbox_inches="tight", pad_inches=0.03)
    # Also save a vector PDF for manuscript-quality text and line art.
    fig.savefig(output_path.with_suffix(".pdf"), bbox_inches="tight", pad_inches=0.03)
    plt.close(fig)


def prompt(text: str, default: Optional[str] = None) -> str:
    if default is None:
        shown = f"{text}: "
    else:
        shown = f"{text} [{default}]: "
    ans = input(shown).strip()
    return ans if ans else (default or "")


def prompt_existing_path(text: str) -> Path:
    while True:
        raw = prompt(text)
        path = Path(raw).expanduser()
        if path.exists():
            return path
        print(f"Path does not exist: {path}")


def prompt_output_path(default_name: str) -> Path:
    raw = prompt("Output image path", default_name)
    path = Path(raw).expanduser()
    if path.suffix == "":
        path = path.with_suffix(".png")
    return path


def yes_no(text: str, default: bool = True) -> bool:
    default_text = "Y/n" if default else "y/N"
    while True:
        ans = input(f"{text} [{default_text}]: ").strip().lower()
        if not ans:
            return default
        if ans in {"y", "yes"}:
            return True
        if ans in {"n", "no"}:
            return False
        print("Please enter y or n.")


def choose_pure_file_name() -> str:
    print("\nPure-component file to parse:")
    print("  1) final_abs_pressure_up")
    print("  2) final_abs_fug_up")
    while True:
        ans = prompt("Choose 1 or 2", "1")
        if ans == "1":
            return "final_abs_pressure_up"
        if ans == "2":
            return "final_abs_fug_up"
        if ans in PURE_FILES:
            return ans
        print("Invalid choice.")


def choose_mix_x_mode() -> str:
    print("\nMixture x-axis:")
    print("  1) Component partial pressure/fugacity columns")
    print("  2) Total pressure/fugacity column")
    while True:
        ans = prompt("Choose 1 or 2", "1")
        if ans == "1":
            return "partial"
        if ans == "2":
            return "total"
        if ans.lower() in {"partial", "total"}:
            return ans.lower()
        print("Invalid choice.")



def has_numbered_child_dirs(path: Path) -> bool:
    """
    Return True when an immediate child directory begins with a number.

    Examples matched:
        1_300.000
        2_440.000
        10-test
        3

    Only the current directory level is checked.
    """
    try:
        children = path.iterdir()
    except OSError:
        return False

    for child in children:
        if child.is_dir() and re.match(r"^\d+", child.name):
            return True
    return False


def discover_numbered_dataset_dirs(source_dir: Path) -> List[Path]:
    """
    Scan only the immediate subdirectories of source_dir and return those that
    contain at least one immediate numbered child directory.
    """
    found: List[Path] = []
    for child in sorted(source_dir.iterdir(), key=lambda p: p.name.lower()):
        if child.is_dir() and has_numbered_child_dirs(child):
            found.append(child)
    return found


def collect_auto_discovered_datasets() -> List[Tuple[Path, str]]:
    source_dir = prompt_existing_path("Source directory to scan")
    if not source_dir.is_dir():
        raise NotADirectoryError(f"Not a directory: {source_dir}")

    found = discover_numbered_dataset_dirs(source_dir)
    if not found:
        raise FileNotFoundError(
            f"No immediate subdirectories of {source_dir} contain numbered child directories."
        )

    print("\nAuto-discovered dataset directories:")
    for path in found:
        print(f"  - {path.name}")

    return [(path, path.name) for path in found]


def collect_datasets(kind: str, minimum: int) -> List[Tuple[Path, str]]:
    datasets: List[Tuple[Path, str]] = []
    while True:
        idx = len(datasets) + 1
        path = prompt_existing_path(f"Path for {kind} dataset #{idx}")
        label = prompt(f"Legend/linestyle name for dataset #{idx}", path.name or f"dataset {idx}")
        datasets.append((path, label))
        if len(datasets) >= minimum:
            if not yes_no("Add another dataset?", default=False):
                break
    return datasets


def run_one_pure() -> None:
    file_name = choose_pure_file_name()
    datasets = collect_datasets("length-increasing parent", minimum=1)
    include_lit = yes_no("Overlay <Cn>/<Cn>_exp.csv literature data if present?", default=True)
    show_err = yes_no("Show error bars if present?", default=True)

    pressure_unit = prompt_pressure_unit()
    x_scale = prompt_xscale()
    simulation_uptake_unit, literature_uptake_unit, uptake_output_unit = prompt_uptake_units(include_lit)
    lit_pressure_unit = prompt_literature_pressure_unit("kPa") if include_lit else None

    output_path = prompt_output_path("pure_length_overlay.png")

    all_series: List[Series] = []
    literature_labels: List[str] = []
    for parent, label in datasets:
        all_series.extend(find_pure_series(parent, file_name, label))
        if include_lit:
            lit_label = f"{label} literature" if len(datasets) > 1 else "Literature"
            lit_series = load_pure_literature_series(parent, lit_label)
            all_series.extend(lit_series)
            if lit_series:
                literature_labels.append(lit_label)

    all_series = transform_series_units(
        all_series,
        pressure_unit=pressure_unit,
        x_scale=x_scale,
        simulation_uptake_unit=simulation_uptake_unit,
        literature_uptake_unit=literature_uptake_unit,
        uptake_output_unit=uptake_output_unit,
        literature_pressure_unit=lit_pressure_unit,
        literature_labels=literature_labels,
    )

    quantity = "Pressure" if "pressure" in file_name else "Fugacity"
    x_label = f"{quantity} ({PRESSURE_LABELS[pressure_unit]})"
    y_label = f"Absolute loading ({uptake_unit_label(uptake_output_unit)})"

    plot_series(
        all_series,
        title="Length-increasing pure-component adsorption",
        x_label=x_label,
        y_label=y_label,
        output_path=output_path,
        show_errorbars=show_err,
        x_scale=x_scale,
    )
    print(f"\nSaved plot: {output_path.resolve()}")


def run_one_mix() -> None:
    x_mode = choose_mix_x_mode()
    datasets = collect_datasets("mixture directory", minimum=1)
    include_lit = yes_no(
        "Overlay lit_vals/C1.csv, C2.csv, etc. literature data if present?",
        default=True,
    )

    pressure_unit = prompt_pressure_unit()
    x_scale = prompt_xscale()
    simulation_uptake_unit, literature_uptake_unit, uptake_output_unit = prompt_uptake_units(include_lit)
    lit_pressure_unit = prompt_literature_pressure_unit("kPa") if include_lit else None

    output_path = prompt_output_path("mixture_overlay.png")

    all_series: List[Series] = []
    literature_labels: List[str] = []
    for mix_dir, label in datasets:
        all_series.extend(parse_mixture_file(mix_dir, label, x_mode=x_mode))
        if include_lit:
            lit_label = f"{label} literature" if len(datasets) > 1 else "Literature"
            lit_series = load_mixture_literature_series(mix_dir, lit_label)
            all_series.extend(lit_series)
            if lit_series:
                literature_labels.append(lit_label)
            if x_mode == "partial" and lit_series:
                print(
                    "WARNING: mixture literature x-values are total bulk values while "
                    "simulation components are plotted against partial x-values.",
                    file=sys.stderr,
                )

    all_series = transform_series_units(
        all_series,
        pressure_unit=pressure_unit,
        x_scale=x_scale,
        simulation_uptake_unit=simulation_uptake_unit,
        literature_uptake_unit=literature_uptake_unit,
        uptake_output_unit=uptake_output_unit,
        literature_pressure_unit=lit_pressure_unit,
        literature_labels=literature_labels,
    )

    if x_mode == "partial":
        x_label = f"Component partial pressure or fugacity ({PRESSURE_LABELS[pressure_unit]})"
    else:
        x_label = f"Total pressure or fugacity ({PRESSURE_LABELS[pressure_unit]})"
    y_label = f"Absolute loading ({uptake_unit_label(uptake_output_unit)})"

    plot_series(
        all_series,
        title="Mixture adsorption",
        x_label=x_label,
        y_label=y_label,
        output_path=output_path,
        show_errorbars=False,
        x_scale=x_scale,
    )
    print(f"\nSaved plot: {output_path.resolve()}")


def run_overlay_pure() -> None:
    file_name = choose_pure_file_name()
    datasets = collect_datasets("length-increasing parent", minimum=2)
    include_lit = yes_no("Overlay each dataset's <Cn>/<Cn>_exp.csv literature data if present?", default=True)
    show_err = yes_no("Show error bars if present?", default=True)

    pressure_unit = prompt_pressure_unit()
    x_scale = prompt_xscale()
    simulation_uptake_unit, literature_uptake_unit, uptake_output_unit = prompt_uptake_units(include_lit)
    lit_pressure_unit = prompt_literature_pressure_unit("kPa") if include_lit else None

    output_path = prompt_output_path("pure_length_overlay.png")

    all_series: List[Series] = []
    literature_labels: List[str] = []
    for parent, label in datasets:
        all_series.extend(find_pure_series(parent, file_name, label))
        if include_lit:
            lit_label = f"{label} literature"
            lit_series = load_pure_literature_series(parent, lit_label)
            all_series.extend(lit_series)
            if lit_series:
                literature_labels.append(lit_label)

    all_series = transform_series_units(
        all_series,
        pressure_unit=pressure_unit,
        x_scale=x_scale,
        simulation_uptake_unit=simulation_uptake_unit,
        literature_uptake_unit=literature_uptake_unit,
        uptake_output_unit=uptake_output_unit,
        literature_pressure_unit=lit_pressure_unit,
        literature_labels=literature_labels,
    )

    quantity = "Pressure" if "pressure" in file_name else "Fugacity"
    x_label = f"{quantity} ({PRESSURE_LABELS[pressure_unit]})"
    y_label = f"Absolute loading ({uptake_unit_label(uptake_output_unit)})"

    plot_series(
        all_series,
        title="Length-increasing pure-component adsorption overlay",
        x_label=x_label,
        y_label=y_label,
        output_path=output_path,
        show_errorbars=show_err,
        x_scale=x_scale,
    )
    print(f"\nSaved plot: {output_path.resolve()}")


def run_overlay_mix() -> None:
    x_mode = choose_mix_x_mode()
    datasets = collect_datasets("mixture directory", minimum=2)
    include_lit = yes_no(
        "Overlay each dataset's lit_vals/C1.csv, C2.csv, etc. if present?",
        default=True,
    )

    pressure_unit = prompt_pressure_unit()
    x_scale = prompt_xscale()
    simulation_uptake_unit, literature_uptake_unit, uptake_output_unit = prompt_uptake_units(include_lit)
    lit_pressure_unit = prompt_literature_pressure_unit("kPa") if include_lit else None

    output_path = prompt_output_path("mixture_overlay.png")

    all_series: List[Series] = []
    literature_labels: List[str] = []
    for mix_dir, label in datasets:
        all_series.extend(parse_mixture_file(mix_dir, label, x_mode=x_mode))
        if include_lit:
            lit_label = f"{label} literature"
            lit_series = load_mixture_literature_series(mix_dir, dataset_label=lit_label)
            all_series.extend(lit_series)
            if lit_series:
                literature_labels.append(lit_label)
            if x_mode == "partial" and lit_series:
                print(
                    f"WARNING: {label} literature x-values are total bulk values while "
                    "simulation components are plotted against partial x-values.",
                    file=sys.stderr,
                )

    all_series = transform_series_units(
        all_series,
        pressure_unit=pressure_unit,
        x_scale=x_scale,
        simulation_uptake_unit=simulation_uptake_unit,
        literature_uptake_unit=literature_uptake_unit,
        uptake_output_unit=uptake_output_unit,
        literature_pressure_unit=lit_pressure_unit,
        literature_labels=literature_labels,
    )

    if x_mode == "partial":
        x_label = f"Component partial pressure or fugacity ({PRESSURE_LABELS[pressure_unit]})"
    else:
        x_label = f"Total pressure or fugacity ({PRESSURE_LABELS[pressure_unit]})"
    y_label = f"Absolute loading ({uptake_unit_label(uptake_output_unit)})"

    plot_series(
        all_series,
        title="Mixture adsorption overlay",
        x_label=x_label,
        y_label=y_label,
        output_path=output_path,
        show_errorbars=False,
        x_scale=x_scale,
    )
    print(f"\nSaved plot: {output_path.resolve()}")



def run_auto_discover() -> None:
    """
    Scan a source directory's immediate subdirectories. Any subdirectory that
    contains immediate numbered child directories is considered a candidate.

    For each candidate:
      - if final_mix_abs_molkg exists in the candidate directory, treat it as a mixture dataset;
      - otherwise, try to find pure-component final_abs_pressure_up/final_abs_fug_up files below it.

    A single auto-discovery run plots one dataset type at a time. If both pure and
    mixture candidates are found, the user chooses which group to plot.
    """
    datasets = collect_auto_discovered_datasets()

    pure_candidates: List[Path] = []
    mix_candidates: List[Path] = []

    for path, _label in datasets:
        if (path / MIX_FILE).is_file():
            mix_candidates.append(path)
        else:
            pure_candidates.append(path)

    if not pure_candidates and not mix_candidates:
        raise FileNotFoundError(
            "Numbered dataset directories were found, but none matched a supported "
            "pure-component or mixture layout."
        )

    mode: str
    if pure_candidates and mix_candidates:
        print("\nAuto-discovery found both dataset types:")
        print(f"  1) Pure-component candidates: {len(pure_candidates)}")
        print(f"  2) Mixture candidates:        {len(mix_candidates)}")
        while True:
            ans = prompt("Which type should be plotted? Choose 1 or 2", "1")
            if ans == "1":
                mode = "pure"
                break
            if ans == "2":
                mode = "mix"
                break
            print("Invalid choice.")
    elif mix_candidates:
        mode = "mix"
    else:
        mode = "pure"

    include_lit = yes_no(
        "Overlay literature data if present?",
        default=False,
    )
    pressure_unit = prompt_pressure_unit()
    x_scale = prompt_xscale()
    simulation_uptake_unit, literature_uptake_unit, uptake_output_unit = prompt_uptake_units(include_lit)
    lit_pressure_unit = prompt_literature_pressure_unit("kPa") if include_lit else None
    literature_labels: List[str] = []
    all_series: List[Series] = []

    if mode == "pure":
        file_name = choose_pure_file_name()
        show_err = yes_no("Show error bars if present?", default=True)
        output_path = prompt_output_path("auto_discovered_pure_overlay.png")

        skipped: List[str] = []
        for parent in pure_candidates:
            label = parent.name
            try:
                all_series.extend(find_pure_series(parent, file_name, label))
            except FileNotFoundError:
                skipped.append(label)
                continue

            if include_lit:
                lit_label = f"{label} literature"
                lit_series = load_pure_literature_series(parent, lit_label)
                all_series.extend(lit_series)
                if lit_series:
                    literature_labels.append(lit_label)

        if skipped:
            print(
                "\nSkipped pure candidates with no matching "
                f"{file_name!r} data: {', '.join(skipped)}",
                file=sys.stderr,
            )

        if not all_series:
            raise FileNotFoundError(
                f"No usable pure-component {file_name!r} data were found."
            )

        quantity = "Pressure" if "pressure" in file_name else "Fugacity"
        x_label = f"{quantity} ({PRESSURE_LABELS[pressure_unit]})"
        y_label = f"Absolute loading ({uptake_unit_label(uptake_output_unit)})"

        all_series = transform_series_units(
            all_series,
            pressure_unit=pressure_unit,
            x_scale=x_scale,
            simulation_uptake_unit=simulation_uptake_unit,
            literature_uptake_unit=literature_uptake_unit,
            uptake_output_unit=uptake_output_unit,
            literature_pressure_unit=lit_pressure_unit,
            literature_labels=literature_labels,
        )

        plot_series(
            all_series,
            title="Auto-discovered pure-component datasets",
            x_label=x_label,
            y_label=y_label,
            output_path=output_path,
            show_errorbars=show_err,
            x_scale=x_scale,
        )

    else:
        x_mode = choose_mix_x_mode()
        output_path = prompt_output_path("auto_discovered_mixture_overlay.png")

        for mix_dir in mix_candidates:
            label = mix_dir.name
            all_series.extend(parse_mixture_file(mix_dir, label, x_mode=x_mode))

            if include_lit:
                lit_label = f"{label} literature"
                lit_series = load_mixture_literature_series(
                    mix_dir,
                    dataset_label=lit_label,
                )
                all_series.extend(lit_series)
                if lit_series:
                    literature_labels.append(lit_label)

                if x_mode == "partial" and lit_series:
                    print(
                        f"WARNING: {label} literature x-values are total bulk values while "
                        "simulation components are plotted against partial x-values.",
                        file=sys.stderr,
                    )

        if not all_series:
            raise FileNotFoundError("No usable mixture data were found.")

        all_series = transform_series_units(
            all_series,
            pressure_unit=pressure_unit,
            x_scale=x_scale,
            simulation_uptake_unit=simulation_uptake_unit,
            literature_uptake_unit=literature_uptake_unit,
            uptake_output_unit=uptake_output_unit,
            literature_pressure_unit=lit_pressure_unit,
            literature_labels=literature_labels,
        )

        if x_mode == "partial":
            x_label = f"Component partial pressure or fugacity ({PRESSURE_LABELS[pressure_unit]})"
        else:
            x_label = f"Total pressure or fugacity ({PRESSURE_LABELS[pressure_unit]})"
        y_label = f"Absolute loading ({uptake_unit_label(uptake_output_unit)})"

        plot_series(
            all_series,
            title="Auto-discovered mixture datasets",
            x_label=x_label,
            y_label=y_label,
            output_path=output_path,
            show_errorbars=False,
            x_scale=x_scale,
        )

    print(f"\nSaved plot: {output_path.resolve()}")


def main() -> None:
    print("RASPA Plot Terminal Menu")
    print("Color = component. Linestyle = dataset. Axis scale and units are selectable.\n")

    while True:
        print("Choose mode:")
        print("  1) Plot one length-increasing parent")
        print("  2) Plot one mixture directory")
        print("  3) Overlay length-increasing parents")
        print("  4) Overlay mixture directories")
        print("  5) Auto-discover immediate subdirectories containing numbered directories")
        print("  q) Quit")
        choice = prompt("Selection").lower()

        try:
            if choice == "1":
                run_one_pure()
            elif choice == "2":
                run_one_mix()
            elif choice == "3":
                run_overlay_pure()
            elif choice == "4":
                run_overlay_mix()
            elif choice == "5":
                run_auto_discover()
            elif choice in {"q", "quit", "exit"}:
                return
            else:
                print("Invalid choice.\n")
                continue
        except KeyboardInterrupt:
            print("\nCanceled.")
        except Exception as exc:
            print(f"\nERROR: {exc}", file=sys.stderr)

        print()
        if not yes_no("Return to main menu?", default=True):
            break
        print()


if __name__ == "__main__":
    main()
