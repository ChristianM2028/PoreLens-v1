#!/usr/bin/env python3
"""
Extract RASPA GEMC coexistence data from unfinished or completed runs.

The parser deliberately ignores the end-of-run summary.  For each box output it
collects complete periodic observations beginning with "Current cycle:".  When
RASPA prints cumulative averages, the last available average is used.  When it
prints only instantaneous values (as it commonly does during [Init]), the
periodic observations are averaged.  The final cycle containing a complete
component-density line is recorded even when no final summary exists.

Typical use
-----------
    python gemc_vle.py /path/to/GEMC/runs

Expected layouts include, for example:
    ROOT/300/Output/System_0/output_*.data
    ROOT/300/Output/System_1/output_*.data

The temperature is read from the output or a nearby simulation.input.  As a
last resort, a numeric directory name in the physically plausible range
50--2000 K is used.
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

os.environ.setdefault(
    "MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / f"matplotlib-{os.getuid()}")
)
import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt

try:
    from scipy.optimize import least_squares
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "This script requires scipy. Install it with: python -m pip install scipy"
    ) from exc


FLOAT = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?"
CYCLE_RE = re.compile(
    r"(?im)^\s*(?:\[[^\]\r\n]+\]\s*)?"
    r"Current\s+cycle:\s*(\d+)\s+out\s+of\s+(\d+)"
)
PRESSURE_RE = re.compile(
    rf"(?im)^\s*Average\s+pressure:\s*({FLOAT})\s*\[kPa\]"
)
DENSITY_RE = re.compile(
    rf"(?im)^\s*Component\s+(\d+)\s+\(([^)]+)\).*?"
    rf"density:\s*({FLOAT})"
    rf"(?:\s+\(average\s+({FLOAT})\))?\s*\[?kg/m\^3\]?"
)
STRESS_LINE_RE = re.compile(r"(?im)^\s*Current\s+Stress:\s*(.*)$")
SYSTEM_PATH_RE = re.compile(r"(?i)^System[_-]?(\d+)$")
TEMPERATURE_PATTERNS = (
    re.compile(
        rf"(?im)^\s*External\s+temperature\s*:\s*({FLOAT})\s*\[K\]"
    ),
    re.compile(rf"(?im)^\s*ExternalTemperature\s+({FLOAT})(?:\s|$)"),
    re.compile(rf"(?im)^\s*Temperature\s*:\s*({FLOAT})\s*\[K\]"),
)


@dataclass(frozen=True)
class BoxRecord:
    path: Path
    run_key: str
    system: int
    temperature_K: float
    first_cycle: int
    cycle: int
    requested_cycles: int
    pressure_kPa: float
    density_kg_m3: float
    density_samples: int
    pressure_samples: int
    components: tuple[str, ...]


@dataclass(frozen=True)
class CoexistenceRecord:
    run_key: str
    temperature_K: float
    vapor_system: int
    liquid_system: int
    vapor_density_kg_m3: float
    liquid_density_kg_m3: float
    vapor_pressure_kPa: float
    liquid_pressure_kPa: float
    coexistence_pressure_kPa: float
    pressure_mismatch_pct: float
    vapor_first_cycle: int
    liquid_first_cycle: int
    vapor_last_cycle: int
    liquid_last_cycle: int
    vapor_density_samples: int
    liquid_density_samples: int
    vapor_pressure_samples: int
    liquid_pressure_samples: int
    vapor_output: str
    liquid_output: str
    components: str


def read_text(path: Path) -> str | None:
    try:
        if path.stat().st_size > 200_000_000:
            return None
        return path.read_text(errors="replace")
    except (OSError, UnicodeError):
        return None


def temperature_from_text(text: str) -> float | None:
    for pattern in TEMPERATURE_PATTERNS:
        match = pattern.search(text)
        if match:
            value = float(match.group(1))
            if 0.0 < value < 5000.0:
                return value
    return None


def nearby_temperature(path: Path, root: Path, output_text: str) -> float | None:
    value = temperature_from_text(output_text)
    if value is not None:
        return value

    # Search nearby inputs, beginning with the output's closest ancestors.
    ancestors = [path.parent, *path.parents]
    seen: set[Path] = set()
    for directory in ancestors:
        if directory in seen:
            continue
        seen.add(directory)
        for name in ("simulation.input", "input", "simulation.inp"):
            candidate = directory / name
            if candidate.is_file():
                text = read_text(candidate)
                if text:
                    value = temperature_from_text(text)
                    if value is not None:
                        return value
        if directory == root:
            break

    # Last-resort convention: a directory named by temperature.
    try:
        relative_parts = path.relative_to(root).parts[:-1]
    except ValueError:
        relative_parts = path.parts[:-1]
    numeric_candidates: list[float] = []
    for part in relative_parts:
        try:
            number = float(part.rstrip("Kk"))
        except ValueError:
            continue
        if 50.0 <= number <= 2000.0:
            numeric_candidates.append(number)
    return numeric_candidates[-1] if numeric_candidates else None


def system_and_run_key(path: Path, root: Path) -> tuple[int, str] | None:
    try:
        relative = path.relative_to(root)
    except ValueError:
        relative = path
    parts = list(relative.parts)
    for index, part in enumerate(parts[:-1]):
        match = SYSTEM_PATH_RE.match(part)
        if not match:
            continue
        system = int(match.group(1))
        prefix = parts[:index]
        if prefix and prefix[-1].lower() == "output":
            prefix = prefix[:-1]
        run_key = str(Path(*prefix)) if prefix else "."
        return system, run_key
    return None


@dataclass(frozen=True)
class PeriodicObservation:
    cycle: int
    requested_cycles: int
    current_density_kg_m3: float
    average_density_kg_m3: float | None
    current_pressure_kPa: float | None
    average_pressure_kPa: float | None
    components: tuple[str, ...]


def current_pressure_from_stress(block: str) -> float | None:
    """Return hydrostatic pressure from the instantaneous stress tensor."""
    lines = block.splitlines()
    for index, line in enumerate(lines):
        match = STRESS_LINE_RE.match(line)
        if not match or index + 2 >= len(lines):
            continue
        rows: list[list[float]] = []
        first = match.group(1).split("[MPa]", 1)[0]
        rows.append([float(value) for value in re.findall(FLOAT, first)[:3]])
        for following in lines[index + 1 : index + 3]:
            # RASPA places the current tensor in the first three columns and,
            # when present, the cumulative average tensor farther to the right.
            rows.append(
                [float(value) for value in re.findall(FLOAT, following)[:3]]
            )
        if all(len(row) == 3 for row in rows):
            return 1000.0 * (rows[0][0] + rows[1][1] + rows[2][2]) / 3.0
    return None


def periodic_observations(text: str) -> list[PeriodicObservation]:
    starts = list(CYCLE_RE.finditer(text))
    observations: list[PeriodicObservation] = []
    for index, start in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
        block = text[start.start() : end]
        densities = list(DENSITY_RE.finditer(block))
        # A block is usable once every printed density line is syntactically
        # complete. Pressure is optional because some RASPA initialization
        # output omits the stress/pressure section entirely.
        if not densities:
            continue
        current_density = sum(float(match.group(3)) for match in densities)
        average_values = [match.group(4) for match in densities]
        average_density = (
            sum(float(value) for value in average_values if value is not None)
            if all(value is not None for value in average_values)
            else None
        )
        average_pressure_match = PRESSURE_RE.search(block)
        average_pressure = (
            float(average_pressure_match.group(1))
            if average_pressure_match
            else None
        )
        components = tuple(match.group(2).strip() for match in densities)
        observations.append(
            PeriodicObservation(
                cycle=int(start.group(1)),
                requested_cycles=int(start.group(2)),
                current_density_kg_m3=current_density,
                average_density_kg_m3=average_density,
                current_pressure_kPa=current_pressure_from_stress(block),
                average_pressure_kPa=average_pressure,
                components=components,
            )
        )
    return observations


def summarize_observations(
    observations: list[PeriodicObservation], start_cycle: int | None
) -> tuple[int, int, int, float, float, int, int, tuple[str, ...]] | None:
    retained = [
        observation
        for observation in observations
        if start_cycle is None or observation.cycle >= start_cycle
    ]
    if not retained:
        return None

    last = retained[-1]
    # Prefer RASPA's last cumulative average when supplied. Otherwise average
    # the instantaneous periodic observations from the retained window.
    density = (
        last.average_density_kg_m3
        if last.average_density_kg_m3 is not None
        else float(np.mean([item.current_density_kg_m3 for item in retained]))
    )
    density_samples = (
        0 if last.average_density_kg_m3 is not None else len(retained)
    )

    average_pressures = [
        item.average_pressure_kPa
        for item in retained
        if item.average_pressure_kPa is not None
    ]
    if average_pressures:
        pressure = average_pressures[-1]
        pressure_samples = 0
    else:
        instantaneous_pressures = [
            item.current_pressure_kPa
            for item in retained
            if item.current_pressure_kPa is not None
        ]
        pressure = (
            float(np.mean(instantaneous_pressures))
            if instantaneous_pressures
            else math.nan
        )
        pressure_samples = len(instantaneous_pressures)

    return (
        retained[0].cycle,
        last.cycle,
        last.requested_cycles,
        pressure,
        density,
        density_samples,
        pressure_samples,
        last.components,
    )


def discover_box_records(
    root: Path, start_cycle: int | None
) -> tuple[list[BoxRecord], list[str]]:
    records: list[BoxRecord] = []
    warnings: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        location = system_and_run_key(path, root)
        if location is None:
            continue
        text = read_text(path)
        if not text or "Current cycle:" not in text:
            continue
        parsed = summarize_observations(periodic_observations(text), start_cycle)
        if parsed is None:
            qualifier = (
                f" at or after cycle {start_cycle}" if start_cycle is not None else ""
            )
            warnings.append(f"No complete density observation{qualifier}: {path}")
            continue
        temperature = nearby_temperature(path, root, text)
        if temperature is None:
            warnings.append(f"Could not determine temperature: {path}")
            continue
        system, run_key = location
        (
            first_cycle,
            cycle,
            requested,
            pressure,
            density,
            density_samples,
            pressure_samples,
            components,
        ) = parsed
        records.append(
            BoxRecord(
                path=path,
                run_key=run_key,
                system=system,
                temperature_K=temperature,
                first_cycle=first_cycle,
                cycle=cycle,
                requested_cycles=requested,
                pressure_kPa=pressure,
                density_kg_m3=density,
                density_samples=density_samples,
                pressure_samples=pressure_samples,
                components=components,
            )
        )
    return records, warnings


def select_latest_outputs(records: Iterable[BoxRecord]) -> list[BoxRecord]:
    selected: dict[tuple[str, int], BoxRecord] = {}
    for record in records:
        key = (record.run_key, record.system)
        old = selected.get(key)
        if old is None:
            selected[key] = record
            continue
        old_rank = (old.cycle, old.path.stat().st_mtime)
        new_rank = (record.cycle, record.path.stat().st_mtime)
        if new_rank > old_rank:
            selected[key] = record
    return list(selected.values())


def pair_boxes(records: Iterable[BoxRecord]) -> tuple[list[CoexistenceRecord], list[str]]:
    grouped: dict[str, list[BoxRecord]] = {}
    for record in records:
        grouped.setdefault(record.run_key, []).append(record)

    coexistence: list[CoexistenceRecord] = []
    warnings: list[str] = []
    for run_key, boxes in sorted(grouped.items()):
        if len(boxes) != 2:
            warnings.append(
                f"{run_key}: expected exactly 2 boxes, found {len(boxes)} "
                f"(systems {[box.system for box in boxes]})"
            )
            continue
        if not math.isclose(
            boxes[0].temperature_K,
            boxes[1].temperature_K,
            rel_tol=0.0,
            abs_tol=1e-6,
        ):
            warnings.append(f"{run_key}: the two boxes report different temperatures")
            continue

        vapor, liquid = sorted(boxes, key=lambda box: box.density_kg_m3)
        box_pressures = np.array(
            [vapor.pressure_kPa, liquid.pressure_kPa], dtype=float
        )
        finite_pressures = box_pressures[np.isfinite(box_pressures)]
        p_mean = (
            float(np.mean(finite_pressures)) if len(finite_pressures) else math.nan
        )
        if len(finite_pressures) == 2 and p_mean != 0.0:
            p_difference = abs(vapor.pressure_kPa - liquid.pressure_kPa)
            mismatch = 100.0 * p_difference / abs(p_mean)
        else:
            mismatch = math.nan
            if len(finite_pressures) == 0:
                warnings.append(
                    f"{run_key}: no pressure or stress data were printed; "
                    "density coexistence is usable, but vapor pressure is unavailable"
                )
            else:
                missing = (
                    vapor.system
                    if not math.isfinite(vapor.pressure_kPa)
                    else liquid.system
                )
                warnings.append(
                    f"{run_key}: System_{missing} has no pressure data; "
                    "the available box pressure is used without a mismatch check"
                )
        all_components = sorted(set(vapor.components) | set(liquid.components))
        coexistence.append(
            CoexistenceRecord(
                run_key=run_key,
                temperature_K=vapor.temperature_K,
                vapor_system=vapor.system,
                liquid_system=liquid.system,
                vapor_density_kg_m3=vapor.density_kg_m3,
                liquid_density_kg_m3=liquid.density_kg_m3,
                vapor_pressure_kPa=vapor.pressure_kPa,
                liquid_pressure_kPa=liquid.pressure_kPa,
                coexistence_pressure_kPa=p_mean,
                pressure_mismatch_pct=mismatch,
                vapor_first_cycle=vapor.first_cycle,
                liquid_first_cycle=liquid.first_cycle,
                vapor_last_cycle=vapor.cycle,
                liquid_last_cycle=liquid.cycle,
                vapor_density_samples=vapor.density_samples,
                liquid_density_samples=liquid.density_samples,
                vapor_pressure_samples=vapor.pressure_samples,
                liquid_pressure_samples=liquid.pressure_samples,
                vapor_output=str(vapor.path),
                liquid_output=str(liquid.path),
                components=";".join(all_components),
            )
        )
    return coexistence, warnings


def aggregate_by_temperature(
    records: list[CoexistenceRecord],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    grouped: dict[float, list[CoexistenceRecord]] = {}
    for record in records:
        grouped.setdefault(record.temperature_K, []).append(record)
    temperatures = np.array(sorted(grouped), dtype=float)
    rho_v = np.array(
        [
            np.mean([record.vapor_density_kg_m3 for record in grouped[temp]])
            for temp in temperatures
        ]
    )
    rho_l = np.array(
        [
            np.mean([record.liquid_density_kg_m3 for record in grouped[temp]])
            for temp in temperatures
        ]
    )
    pressure = np.array(
        [
            np.nanmean(
                [record.coexistence_pressure_kPa for record in grouped[temp]]
            )
            if np.any(
                np.isfinite(
                    [record.coexistence_pressure_kPa for record in grouped[temp]]
                )
            )
            else math.nan
            for temp in temperatures
        ]
    )
    return temperatures, rho_v, rho_l, pressure


def fit_density_scaling(
    temperature: np.ndarray,
    rho_v: np.ndarray,
    rho_l: np.ndarray,
    beta: float,
) -> dict[str, float]:
    """Jointly fit rectilinear diameter and coexistence-density scaling."""
    max_t = float(np.max(temperature))
    span = max(float(np.ptp(temperature)), 1.0)
    diameter = 0.5 * (rho_l + rho_v)
    gap = rho_l - rho_v

    def residual(params: np.ndarray) -> np.ndarray:
        tc, rhoc, slope, amplitude = params
        delta_t = np.maximum(tc - temperature, 1e-12)
        predicted_diameter = rhoc + slope * delta_t
        predicted_gap = amplitude * delta_t**beta
        density_scale = max(float(np.mean(diameter)), 1.0)
        gap_scale = max(float(np.mean(gap)), 1.0)
        return np.concatenate(
            [
                (predicted_diameter - diameter) / density_scale,
                (predicted_gap - gap) / gap_scale,
            ]
        )

    initial = np.array(
        [
            max_t + 0.2 * span,
            max(float(diameter[-1]), 1e-6),
            (diameter[0] - diameter[-1]) / max(temperature[-1] - temperature[0], 1.0),
            max(float(gap[-1]), 1e-6) / (0.2 * span) ** beta,
        ]
    )
    lower = np.array([max_t + 1e-6, 0.0, -np.inf, 0.0])
    upper = np.array([max_t + 5.0 * span, np.inf, np.inf, np.inf])
    result = least_squares(residual, initial, bounds=(lower, upper), max_nfev=50_000)
    if not result.success:
        raise RuntimeError(f"Density fit failed: {result.message}")

    tc, rhoc, slope, amplitude = result.x
    fitted_residual = residual(result.x)
    return {
        "Tc_K": float(tc),
        "rhoc_kg_m3": float(rhoc),
        "diameter_slope_kg_m3_K": float(slope),
        "gap_amplitude_kg_m3_K_beta": float(amplitude),
        "density_scaled_rmse": float(np.sqrt(np.mean(fitted_residual**2))),
    }


def fit_vapor_pressure(
    temperature: np.ndarray, pressure_kpa: np.ndarray, tc: float
) -> dict[str, float | int]:
    valid = np.isfinite(pressure_kpa) & (pressure_kpa > 0.0)
    t = temperature[valid]
    p = pressure_kpa[valid]
    if len(t) < 2:
        raise RuntimeError("At least two positive coexistence pressures are required")
    degree = 2 if len(t) >= 4 else 1
    coefficients = np.polyfit(1.0 / t, np.log(p), degree)
    log_pc = float(np.polyval(coefficients, 1.0 / tc))
    predicted = np.polyval(coefficients, 1.0 / t)
    return {
        "Pc_kPa": float(np.exp(log_pc)),
        "pressure_fit_degree": degree,
        "ln_pressure_rmse": float(np.sqrt(np.mean((predicted - np.log(p)) ** 2))),
    }


def write_csv(path: Path, records: list[CoexistenceRecord]) -> None:
    fields = list(CoexistenceRecord.__dataclass_fields__)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for record in sorted(records, key=lambda row: (row.temperature_K, row.run_key)):
            writer.writerow({field: getattr(record, field) for field in fields})


def plot_results(
    outdir: Path,
    temperature: np.ndarray,
    rho_v: np.ndarray,
    rho_l: np.ndarray,
    pressure: np.ndarray,
    fit_t: np.ndarray | None,
    fit_rho_v: np.ndarray | None,
    fit_rho_l: np.ndarray | None,
    fit_pressure: np.ndarray | None,
    critical: dict[str, float | int] | None,
) -> None:
    fig, ax = plt.subplots(figsize=(7.2, 5.2))
    ax.plot(rho_v, temperature, "o-", label="Vapor branch")
    ax.plot(rho_l, temperature, "o-", label="Liquid branch")
    if critical and fit_t is not None and fit_rho_v is not None and fit_rho_l is not None:
        ax.plot(fit_rho_v, fit_t, "--", color="C0", alpha=0.75)
        ax.plot(fit_rho_l, fit_t, "--", color="C1", alpha=0.75)
        ax.plot(
            critical["rhoc_kg_m3"],
            critical["Tc_K"],
            "*",
            color="black",
            markersize=13,
            label="Estimated critical point",
        )
    ax.set_xlabel(r"Density, $\rho$ (kg m$^{-3}$)")
    ax.set_ylabel("Temperature (K)")
    ax.set_title("GEMC vapor–liquid coexistence")
    ax.grid(alpha=0.25)
    ax.legend()
    fig.tight_layout()
    fig.savefig(outdir / "vle_coexistence.png", dpi=300)
    fig.savefig(outdir / "vle_coexistence.pdf")
    plt.close(fig)

    valid_pressure = np.isfinite(pressure) & (pressure > 0.0)
    if not np.any(valid_pressure):
        for stale_name in ("vapor_pressure.png", "vapor_pressure.pdf"):
            stale = outdir / stale_name
            if stale.exists():
                stale.unlink()
        return

    fig, ax = plt.subplots(figsize=(7.2, 5.2))
    ax.semilogy(
        temperature[valid_pressure],
        pressure[valid_pressure],
        "o",
        label="GEMC coexistence pressure",
    )
    if fit_t is not None and fit_pressure is not None:
        ax.semilogy(fit_t, fit_pressure, "-", label="Vapor-pressure fit")
    if critical and "Pc_kPa" in critical:
        ax.semilogy(
            critical["Tc_K"],
            critical["Pc_kPa"],
            "*",
            color="black",
            markersize=13,
            label="Estimated critical point",
        )
    ax.set_xlabel("Temperature (K)")
    ax.set_ylabel("Pressure (kPa)")
    ax.set_title("GEMC vapor pressure")
    ax.grid(alpha=0.25, which="both")
    ax.legend()
    fig.tight_layout()
    fig.savefig(outdir / "vapor_pressure.png", dpi=300)
    fig.savefig(outdir / "vapor_pressure.pdf")
    plt.close(fig)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Average usable periodic observations from paired RASPA GEMC box "
            "outputs, plot VLE coexistence, and estimate critical properties."
        )
    )
    parser.add_argument("root", type=Path, help="Root directory containing GEMC runs")
    parser.add_argument(
        "-o",
        "--outdir",
        type=Path,
        default=Path("gemc_vle_results"),
        help="Output directory (default: gemc_vle_results)",
    )
    parser.add_argument(
        "--start-cycle",
        type=int,
        default=None,
        help=(
            "Average only periodic observations at or after this cycle. "
            "By default, all observations in each output file are retained."
        ),
    )
    parser.add_argument(
        "--fit-points",
        type=int,
        default=6,
        help=(
            "Number of highest-temperature coexistence points used for critical "
            "fits; 0 uses all points (default: 6)"
        ),
    )
    parser.add_argument(
        "--beta",
        type=float,
        default=0.325,
        help="Fixed coexistence-curve critical exponent (default: 0.325)",
    )
    parser.add_argument(
        "--no-fit",
        action="store_true",
        help="Extract and plot the raw coexistence data without critical fitting",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    root = args.root.resolve()
    outdir = args.outdir.resolve()
    if not root.is_dir():
        raise SystemExit(f"Not a directory: {root}")
    if args.start_cycle is not None and args.start_cycle < 0:
        raise SystemExit("--start-cycle must be nonnegative")
    outdir.mkdir(parents=True, exist_ok=True)

    raw_records, discovery_warnings = discover_box_records(root, args.start_cycle)
    selected = select_latest_outputs(raw_records)
    coexistence, pairing_warnings = pair_boxes(selected)
    warnings = discovery_warnings + pairing_warnings
    if not coexistence:
        for warning in warnings:
            print(f"WARNING: {warning}", file=sys.stderr)
        raise SystemExit(
            "No paired GEMC state points were found. Each run must contain "
            "System_0 and System_1 outputs with complete periodic blocks."
        )

    write_csv(outdir / "coexistence_data.csv", coexistence)
    temperature, rho_v, rho_l, pressure = aggregate_by_temperature(coexistence)
    critical: dict[str, float | int] | None = None
    fit_t = fit_rho_v = fit_rho_l = fit_pressure = None

    component_sets = {record.components for record in coexistence}
    if len(component_sets) > 1:
        warnings.append(
            "Component lists differ among state points; verify that these runs "
            "belong to one fluid before interpreting a single critical fit."
        )

    if not args.no_fit:
        if len(temperature) < 3:
            warnings.append(
                "Critical fit skipped: at least 3 distinct temperatures are required "
                "(5 or more near-critical points are strongly preferred)."
            )
        else:
            count = len(temperature) if args.fit_points == 0 else min(
                max(args.fit_points, 3), len(temperature)
            )
            fit_temperature = temperature[-count:]
            fit_vapor = rho_v[-count:]
            fit_liquid = rho_l[-count:]
            fit_p = pressure[-count:]
            density_fit = fit_density_scaling(
                fit_temperature, fit_vapor, fit_liquid, args.beta
            )
            critical = {
                **density_fit,
                "beta": args.beta,
                "fit_point_count": count,
                "fit_temperature_min_K": float(fit_temperature[0]),
                "fit_temperature_max_K": float(fit_temperature[-1]),
            }
            positive_pressure = np.isfinite(fit_p) & (fit_p > 0.0)
            if np.count_nonzero(positive_pressure) >= 2:
                pressure_fit = fit_vapor_pressure(
                    fit_temperature, fit_p, density_fit["Tc_K"]
                )
                critical.update(pressure_fit)
            else:
                warnings.append(
                    "Pc and the vapor-pressure fit were skipped because fewer "
                    "than two fitted temperatures contain positive pressure data."
                )

            fit_t = np.linspace(
                float(fit_temperature[0]), float(critical["Tc_K"]), 300
            )
            delta_t = np.maximum(float(critical["Tc_K"]) - fit_t, 0.0)
            diameter = (
                float(critical["rhoc_kg_m3"])
                + float(critical["diameter_slope_kg_m3_K"]) * delta_t
            )
            gap = (
                float(critical["gap_amplitude_kg_m3_K_beta"])
                * delta_t ** args.beta
            )
            fit_rho_v = diameter - 0.5 * gap
            fit_rho_l = diameter + 0.5 * gap

            if "pressure_fit_degree" in critical:
                valid_pressure = np.isfinite(fit_p) & (fit_p > 0.0)
                degree = int(critical["pressure_fit_degree"])
                coefficients = np.polyfit(
                    1.0 / fit_temperature[valid_pressure],
                    np.log(fit_p[valid_pressure]),
                    degree,
                )
                fit_pressure = np.exp(np.polyval(coefficients, 1.0 / fit_t))

    plot_results(
        outdir,
        temperature,
        rho_v,
        rho_l,
        pressure,
        fit_t,
        fit_rho_v,
        fit_rho_l,
        fit_pressure,
        critical,
    )

    report_lines = [
        "RASPA GEMC VLE extraction",
        "=========================",
        f"Root: {root}",
        f"Paired state points: {len(coexistence)}",
        f"Distinct temperatures: {len(temperature)}",
        "",
        "Extraction rule:",
        "  No end-of-run summary is required.",
        "  The final cycle with a complete component-density line is retained.",
        (
            "  Periodic observations at/after cycle "
            f"{args.start_cycle} are retained."
            if args.start_cycle is not None
            else "  All periodic observations in each selected output are retained."
        ),
        "  Last cumulative averages are preferred when RASPA prints them.",
        "  Otherwise instantaneous periodic density/stress values are averaged.",
        "  Coexistence pressure is the mean of available box pressures.",
        "",
    ]
    if critical:
        report_lines.extend(
            [
                "Critical-property estimates",
                "-----------------------------",
                f"Tc = {critical['Tc_K']:.6g} K",
                f"rhoc = {critical['rhoc_kg_m3']:.6g} kg/m^3",
                f"beta = {critical['beta']:.6g} (fixed)",
                f"Fit points = {critical['fit_point_count']} highest-temperature points",
                f"Fit range = {critical['fit_temperature_min_K']:.6g}--"
                f"{critical['fit_temperature_max_K']:.6g} K",
                f"Scaled density RMSE = {critical['density_scaled_rmse']:.6g}",
                "",
                "Method:",
                "  rho_l - rho_v = B (Tc - T)^beta",
                "  (rho_l + rho_v)/2 = rhoc + A (Tc - T)",
            ]
        )
        if "Pc_kPa" in critical:
            report_lines.extend(
                [
                    f"Pc = {critical['Pc_kPa']:.6g} kPa "
                    f"({float(critical['Pc_kPa']) / 100.0:.6g} bar)",
                    f"ln(P) RMSE = {critical['ln_pressure_rmse']:.6g}",
                    "  ln(Psat) = polynomial in 1/T; evaluated at fitted Tc for Pc.",
                ]
            )
        else:
            report_lines.append(
                "Pc = not estimated (pressure data were not printed)."
            )
        report_lines.extend(
            [
                "",
                "Treat these as extrapolated estimates. Reliability depends strongly",
                "on having several equilibrated state points close to the critical region.",
                "",
            ]
        )
    else:
        report_lines.extend(["Critical fit: not performed.", ""])

    if warnings:
        report_lines.append("Warnings")
        report_lines.append("--------")
        report_lines.extend(f"- {warning}" for warning in warnings)
        report_lines.append("")

    report_lines.append("Cycles actually used")
    report_lines.append("--------------------")
    for record in sorted(coexistence, key=lambda row: (row.temperature_K, row.run_key)):
        report_lines.append(
            f"{record.temperature_K:g} K ({record.run_key}): "
            f"vapor System_{record.vapor_system} cycles "
            f"{record.vapor_first_cycle}--{record.vapor_last_cycle} "
            f"({record.vapor_density_samples or 'cumulative'} density samples); "
            f"liquid System_{record.liquid_system} cycles "
            f"{record.liquid_first_cycle}--{record.liquid_last_cycle} "
            f"({record.liquid_density_samples or 'cumulative'} density samples); "
            f"box-pressure mismatch {record.pressure_mismatch_pct:.3g}%"
        )
    (outdir / "critical_estimates.txt").write_text("\n".join(report_lines) + "\n")

    for warning in warnings:
        print(f"WARNING: {warning}", file=sys.stderr)
    print(f"Wrote {outdir / 'coexistence_data.csv'}")
    print(f"Wrote {outdir / 'vle_coexistence.png'}")
    if np.any(np.isfinite(pressure) & (pressure > 0.0)):
        print(f"Wrote {outdir / 'vapor_pressure.png'}")
    else:
        print("Skipped vapor_pressure.png: no positive pressure data were found")
    print(f"Wrote {outdir / 'critical_estimates.txt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
