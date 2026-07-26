#!/usr/bin/env python3
"""Create pressure-distance RDF heatmaps and pressure-sensitivity maps.

The input may be either:

* an RDF collection directory containing ``manifest.csv``;
* the ``manifest.csv`` file itself; or
* a .tar, .tar.gz, .tgz, .tar.bz2, or .tar.xz collection archive.

The manifest format is produced by ``collect_rdfs.py``. RASPA RDF files are
interpreted as index, distance [A], normalized g(r), and raw histogram.

For each RDF pair, this script produces:

1. a heatmap of g(r, P);
2. a signed pressure-sensitivity heatmap, d g / d log10(P);
3. continuity-tracked short-range peak distance and height; and
4. fixed-shell excess area above g(r)=1.

The sensitivity is descriptive, not a statistical significance test. Actual
significance requires block uncertainties or independent replicate RDFs.
"""

from __future__ import annotations

import argparse
import csv
import math
import re
import shutil
import sys
import tarfile
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterator, Sequence

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.colors import TwoSlopeNorm


PRESSURE_FACTORS = {
    "Pa": 1.0,
    "kPa": 1e-3,
    "MPa": 1e-6,
    "bar": 1e-5,
}


@dataclass(frozen=True)
class ManifestRecord:
    component: str
    run: str
    pressure_pa: float
    pair_file: str
    data_path: Path


@dataclass
class PairResult:
    component: str
    pair_file: str
    pair_label: str
    pressures_pa: np.ndarray
    distance: np.ndarray
    rdf: np.ndarray
    raw_sums: np.ndarray
    valid: np.ndarray
    sensitivity: np.ndarray
    sensitivity_rms: np.ndarray
    peak_distance: np.ndarray
    peak_height: np.ndarray
    shell_centroid: np.ndarray
    shell_excess_area: np.ndarray
    sampling_cutoff_pa: float | None
    sampling_jump_decades: float


@dataclass(frozen=True)
class ColorScale:
    rdf_vmax: float
    rdf_true_max: float
    sensitivity_limit: float
    sensitivity_true_max: float


def natural_sort_key(value: str) -> tuple[object, ...]:
    """Sort C2 before C10 and retain intuitive ordering elsewhere."""
    return tuple(
        int(part) if part.isdigit() else part.casefold()
        for part in re.split(r"(\d+)", value)
    )


def safe_name(text: str) -> str:
    text = re.sub(r"[^A-Za-z0-9._+-]+", "_", text)
    return re.sub(r"_+", "_", text).strip("._") or "rdf"


def pair_stem(filename: str) -> str:
    name = Path(filename).stem
    return name[4:] if name.casefold().startswith("rdf_") else name


def pair_label(filename: str) -> str:
    stem = pair_stem(filename)
    known_prefixes = (
        "CH2_sp3_",
        "CH3_sp3_",
        "CF2_sp3_",
        "CF3_sp3_",
        "Framework_",
    )
    for prefix in known_prefixes:
        if stem.startswith(prefix):
            return f"{prefix[:-1]} – {stem[len(prefix):]}"
    return stem.replace("_", " ")


def matches_selectors(filename: str, selectors: Sequence[str]) -> bool:
    if not selectors:
        return True
    normalized = pair_stem(filename).casefold()
    return any(selector.casefold().removeprefix("rdf_").removesuffix(".dat") in normalized for selector in selectors)


def validate_archive_member(member: tarfile.TarInfo) -> PurePosixPath:
    path = PurePosixPath(member.name)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Unsafe archive member path: {member.name}")
    if not (member.isfile() or member.isdir()):
        raise ValueError(f"Unsupported archive member type: {member.name}")
    return path


def extract_archive_safely(archive_path: Path, destination: Path) -> None:
    with tarfile.open(archive_path, "r:*") as archive:
        for member in archive.getmembers():
            relative = validate_archive_member(member)
            target = destination.joinpath(*relative.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise ValueError(f"Could not read archive member: {member.name}")
            with source, target.open("wb") as output:
                shutil.copyfileobj(source, output)


def find_manifest(path: Path) -> Path:
    if path.is_file() and path.name == "manifest.csv":
        return path
    candidates = sorted(path.rglob("manifest.csv")) if path.is_dir() else []
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise FileNotFoundError(f"No manifest.csv found under {path}")
    raise ValueError(f"Multiple manifest.csv files found under {path}: {candidates}")


@contextmanager
def materialized_collection(input_path: Path) -> Iterator[Path]:
    input_path = input_path.expanduser().resolve()
    if not input_path.exists():
        raise FileNotFoundError(f"Input does not exist: {input_path}")
    if input_path.is_dir() or input_path.name == "manifest.csv":
        yield find_manifest(input_path)
        return
    with tempfile.TemporaryDirectory(prefix="rdf_heatmaps_") as temporary:
        extraction_root = Path(temporary)
        extract_archive_safely(input_path, extraction_root)
        yield find_manifest(extraction_root)


def read_manifest(manifest: Path, component_filter: str | None) -> list[ManifestRecord]:
    records: list[ManifestRecord] = []
    with manifest.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        required = {"component", "run", "pressure_pa", "rdf_filename", "collected_relative_path"}
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Manifest is missing columns: {', '.join(sorted(missing))}")
        for row in reader:
            component = row["component"].strip()
            if component_filter and component.casefold() != component_filter.casefold():
                continue
            pressure = float(row["pressure_pa"])
            if not math.isfinite(pressure) or pressure <= 0:
                raise ValueError(f"Non-positive or invalid pressure in manifest: {row['pressure_pa']}")
            data_path = manifest.parent / row["collected_relative_path"]
            if not data_path.is_file():
                raise FileNotFoundError(f"RDF file listed in manifest is missing: {data_path}")
            records.append(
                ManifestRecord(
                    component=component,
                    run=row["run"],
                    pressure_pa=pressure,
                    pair_file=row["rdf_filename"],
                    data_path=data_path,
                )
            )
    if not records:
        suffix = f" for component {component_filter}" if component_filter else ""
        raise ValueError(f"Manifest contains no RDF records{suffix}")
    return records


def read_rdf(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    data = np.loadtxt(path, comments="#", dtype=float)
    if data.ndim == 1:
        data = data.reshape(1, -1)
    if data.shape[0] < 2 or data.shape[1] < 4:
        raise ValueError(f"Expected at least two rows and four columns in {path}")
    distance = data[:, 1]
    rdf = data[:, 2]
    raw = data[:, 3]
    if not np.all(np.isfinite(distance)) or not np.all(np.isfinite(rdf)) or not np.all(np.isfinite(raw)):
        raise ValueError(f"Non-finite RDF values in {path}")
    if np.any(np.diff(distance) <= 0):
        raise ValueError(f"Distance grid is not strictly increasing in {path}")
    return distance, rdf, raw


def group_records(records: Sequence[ManifestRecord], selectors: Sequence[str]) -> dict[tuple[str, str], list[ManifestRecord]]:
    grouped: dict[tuple[str, str], list[ManifestRecord]] = {}
    for record in records:
        if matches_selectors(record.pair_file, selectors):
            grouped.setdefault((record.component, record.pair_file), []).append(record)
    if not grouped:
        raise ValueError("No RDF pairs matched --pairs")
    return grouped


def linear_edges(values: np.ndarray) -> np.ndarray:
    if values.size < 2:
        raise ValueError("At least two values are required to construct plot edges")
    middle = 0.5 * (values[:-1] + values[1:])
    first = values[0] - 0.5 * (values[1] - values[0])
    last = values[-1] + 0.5 * (values[-1] - values[-2])
    return np.concatenate(([first], middle, [last]))


def logarithmic_edges(values: np.ndarray) -> np.ndarray:
    log_values = np.log10(values)
    return np.power(10.0, linear_edges(log_values))


def smooth_axis(values: np.ndarray, window: int, axis: int) -> np.ndarray:
    if window <= 1:
        return values.copy()
    axis_length = values.shape[axis]
    if window > axis_length:
        window = axis_length if axis_length % 2 == 1 else axis_length - 1
    if window <= 1:
        return values.copy()
    if window % 2 == 0:
        window += 1
    kernel = np.ones(window, dtype=float)
    moved = np.moveaxis(values, axis, -1)
    output = np.empty_like(moved, dtype=float)
    flattened = moved.reshape(-1, moved.shape[-1])
    flat_output = output.reshape(-1, output.shape[-1])
    for index, row in enumerate(flattened):
        finite = np.isfinite(row)
        numerator = np.convolve(np.where(finite, row, 0.0), kernel, mode="same")
        denominator = np.convolve(finite.astype(float), kernel, mode="same")
        flat_output[index] = np.divide(
            numerator,
            denominator,
            out=np.full_like(numerator, np.nan),
            where=denominator > 0,
        )
    return np.moveaxis(output, -1, axis)


def pair_sampling_mask(
    pressures: np.ndarray,
    raw_sums: np.ndarray,
    jump_threshold_decades: float,
    min_raw_sum: float,
    min_raw_fraction: float,
) -> tuple[np.ndarray, float | None, float]:
    """Build a pair-specific reliability mask from that pair's raw counts.

    Different RDF pairs have very different numbers of possible pairs, so a
    single pressure cutoff is not statistically equivalent across a report.
    This detects an early, abrupt increase in the pair's own histogram count
    and optionally applies absolute and relative count floors.
    """
    valid = np.isfinite(raw_sums) & (raw_sums >= min_raw_sum)
    if min_raw_fraction > 0 and np.any(raw_sums > 0):
        valid &= raw_sums >= min_raw_fraction * float(np.nanmax(raw_sums))

    cutoff: float | None = None
    jump_size = 0.0
    if jump_threshold_decades > 0 and pressures.size >= 3:
        log_raw = np.log10(np.maximum(raw_sums, 1e-300))
        jumps = np.diff(log_raw)
        early_stop = max(1, pressures.size // 2)
        early_jumps = jumps[:early_stop]
        qualifying = np.flatnonzero(early_jumps >= jump_threshold_decades)
        if qualifying.size:
            # Use the final qualifying jump so that a zero-count first row
            # cannot leave a later marginal-count row exposed.
            jump_index = int(qualifying[-1])
            jump_size = float(early_jumps[jump_index])
            cutoff = float(pressures[jump_index + 1])
            valid[: jump_index + 1] = False
    return valid, cutoff, jump_size


def prominent_peaks(
    distance: np.ndarray,
    values: np.ndarray,
    peak_range: tuple[float, float],
    minimum_prominence: float,
    prominence_window_angstrom: float,
) -> list[tuple[float, float, float]]:
    """Return (distance, height, prominence) for locally prominent peaks."""
    in_range = (distance >= peak_range[0]) & (distance <= peak_range[1])
    local_distance = distance[in_range]
    local_values = values[in_range]
    if local_values.size < 3 or not np.all(np.isfinite(local_values)):
        return []
    spacing = float(np.median(np.diff(local_distance)))
    half_window = max(2, int(round(prominence_window_angstrom / spacing)))
    candidates = np.flatnonzero(
        (local_values[1:-1] > local_values[:-2])
        & (local_values[1:-1] >= local_values[2:])
    ) + 1
    peaks: list[tuple[float, float, float]] = []
    for index in candidates:
        left = local_values[max(0, index - half_window) : index]
        right = local_values[index + 1 : min(local_values.size, index + half_window + 1)]
        if left.size == 0 or right.size == 0:
            continue
        prominence = local_values[index] - max(float(np.min(left)), float(np.min(right)))
        if prominence >= minimum_prominence:
            peaks.append(
                (
                    float(local_distance[index]),
                    float(local_values[index]),
                    float(prominence),
                )
            )
    return peaks


def track_continuous_peak(
    distance: np.ndarray,
    rows: np.ndarray,
    peak_range: tuple[float, float],
    minimum_prominence: float,
    prominence_window_angstrom: float,
    maximum_jump_angstrom: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Track one peak without silently switching to a distant shoulder."""
    positions = np.full(rows.shape[0], np.nan, dtype=float)
    heights = np.full(rows.shape[0], np.nan, dtype=float)
    previous_position = np.nan
    for row_index, row in enumerate(rows):
        candidates = prominent_peaks(
            distance,
            row,
            peak_range,
            minimum_prominence,
            prominence_window_angstrom,
        )
        if not candidates:
            continue
        if np.isfinite(previous_position):
            candidates = sorted(candidates, key=lambda peak: abs(peak[0] - previous_position))
            if abs(candidates[0][0] - previous_position) > maximum_jump_angstrom:
                continue
        else:
            # Preserve the original "first prominent peak" definition only at
            # initialization; subsequent rows are selected by continuity.
            candidates = sorted(candidates, key=lambda peak: peak[0])
        positions[row_index], heights[row_index], _prominence = candidates[0]
        previous_position = positions[row_index]
    return positions, heights


def local_linear_sensitivity(
    values: np.ndarray,
    log_pressure: np.ndarray,
    window: int,
) -> np.ndarray:
    """Estimate d g / d log10(P) with centered local linear regressions."""
    if window < 3:
        window = 3
    if window > values.shape[0]:
        window = values.shape[0] if values.shape[0] % 2 == 1 else values.shape[0] - 1
    if window < 3:
        return np.full_like(values, np.nan, dtype=float)
    if window % 2 == 0:
        window += 1
    half = window // 2
    output = np.full_like(values, np.nan, dtype=float)
    for index in range(half, values.shape[0] - half):
        selection = slice(index - half, index + half + 1)
        x = log_pressure[selection]
        y = values[selection]
        centered_x = x - np.mean(x)
        denominator = float(np.sum(centered_x**2))
        if denominator > 0:
            output[index] = np.sum(centered_x[:, None] * y, axis=0) / denominator
    return output


def build_pair_result(
    component: str,
    pair_file: str,
    records: Sequence[ManifestRecord],
    sampling_jump_decades: float,
    min_raw_sum: float,
    min_raw_fraction: float,
    smooth_distance_bins: int,
    smooth_pressure_points: int,
    peak_range: tuple[float, float],
    peak_prominence: float,
    peak_prominence_window: float,
    peak_max_jump: float,
) -> PairResult:
    sorted_records = sorted(records, key=lambda record: record.pressure_pa)
    pressures = np.array([record.pressure_pa for record in sorted_records], dtype=float)
    if np.unique(pressures).size != pressures.size:
        raise ValueError(f"Duplicate pressure records for {component}/{pair_file}")
    distance_reference: np.ndarray | None = None
    rdf_rows: list[np.ndarray] = []
    raw_sums: list[float] = []
    for record in sorted_records:
        distance, rdf, raw = read_rdf(record.data_path)
        if distance_reference is None:
            distance_reference = distance
        elif distance.shape != distance_reference.shape or not np.allclose(distance, distance_reference, rtol=0, atol=1e-10):
            rdf = np.interp(distance_reference, distance, rdf, left=np.nan, right=np.nan)
        rdf_rows.append(rdf)
        raw_sums.append(float(np.sum(raw)))
    assert distance_reference is not None
    rdf_matrix = np.vstack(rdf_rows)
    raw_array = np.asarray(raw_sums, dtype=float)
    valid, sampling_cutoff_pa, sampling_jump_size = pair_sampling_mask(
        pressures,
        raw_array,
        sampling_jump_decades,
        min_raw_sum,
        min_raw_fraction,
    )
    if np.count_nonzero(valid) < 3:
        raise ValueError(f"Fewer than three valid pressures remain for {component}/{pair_file}")

    valid_rdf = rdf_matrix[valid]
    distance_smoothed = smooth_axis(valid_rdf, smooth_distance_bins, axis=1)
    log_pressure = np.log10(pressures[valid])
    valid_sensitivity = local_linear_sensitivity(
        distance_smoothed,
        log_pressure,
        smooth_pressure_points,
    )
    sensitivity = np.full_like(rdf_matrix, np.nan, dtype=float)
    sensitivity[valid] = valid_sensitivity

    sensitivity_rms = np.full(pressures.shape, np.nan, dtype=float)
    valid_rms = np.full(valid_sensitivity.shape[0], np.nan, dtype=float)
    finite_sensitivity_rows = np.any(np.isfinite(valid_sensitivity), axis=1)
    valid_rms[finite_sensitivity_rows] = np.sqrt(
        np.nanmean(valid_sensitivity[finite_sensitivity_rows] ** 2, axis=1)
    )
    sensitivity_rms[valid] = valid_rms

    peak_distance = np.full(pressures.shape, np.nan, dtype=float)
    peak_height = np.full(pressures.shape, np.nan, dtype=float)
    shell_centroid = np.full(pressures.shape, np.nan, dtype=float)
    shell_excess_area = np.full(pressures.shape, np.nan, dtype=float)
    in_peak_range = (distance_reference >= peak_range[0]) & (distance_reference <= peak_range[1])
    if not np.any(in_peak_range):
        raise ValueError(
            f"Peak range {peak_range} does not overlap the distance grid for {pair_file}"
        )
    peak_smoothed = smooth_axis(distance_smoothed, smooth_pressure_points, axis=0)
    valid_peak_distance, valid_peak_height = track_continuous_peak(
        distance_reference,
        peak_smoothed,
        peak_range,
        peak_prominence,
        peak_prominence_window,
        peak_max_jump,
    )
    valid_indices = np.flatnonzero(valid)
    peak_distance[valid_indices] = valid_peak_distance
    peak_height[valid_indices] = valid_peak_height
    shell_distance = distance_reference[in_peak_range]
    for output_index, row in zip(valid_indices, peak_smoothed):
        shell_values = row[in_peak_range]
        excess = np.maximum(shell_values - 1.0, 0.0)
        area = float(np.trapezoid(excess, shell_distance))
        shell_excess_area[output_index] = area
        if area > 0:
            shell_centroid[output_index] = float(
                np.trapezoid(shell_distance * excess, shell_distance) / area
            )

    return PairResult(
        component=component,
        pair_file=pair_file,
        pair_label=pair_label(pair_file),
        pressures_pa=pressures,
        distance=distance_reference,
        rdf=rdf_matrix,
        raw_sums=raw_array,
        valid=valid,
        sensitivity=sensitivity,
        sensitivity_rms=sensitivity_rms,
        peak_distance=peak_distance,
        peak_height=peak_height,
        shell_centroid=shell_centroid,
        shell_excess_area=shell_excess_area,
        sampling_cutoff_pa=sampling_cutoff_pa,
        sampling_jump_decades=sampling_jump_size,
    )


def finite_percentile(values: np.ndarray, percentile: float, minimum: float) -> float:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return minimum
    return max(minimum, float(np.percentile(finite, percentile)))


def configured_colormap(
    name: str,
    *,
    over: str | None = None,
    under: str | None = None,
):
    cmap = plt.get_cmap(name).copy()
    cmap.set_bad("#d9d9d9")
    if over is not None:
        cmap.set_over(over)
    if under is not None:
        cmap.set_under(under)
    return cmap


def color_scale_group(result: PairResult, scope: str) -> str:
    if scope == "global":
        return "all"
    if scope == "family":
        return pair_stem(result.pair_file).casefold()
    return f"{result.component.casefold()}::{result.pair_file.casefold()}"


def compute_color_scales(
    results: Sequence[PairResult],
    scope: str,
    rdf_percentile: float,
    sensitivity_percentile: float,
) -> dict[tuple[str, str], ColorScale]:
    """Calculate robust scales once per comparable collection of panels."""
    grouped: dict[str, list[PairResult]] = {}
    for result in results:
        grouped.setdefault(color_scale_group(result, scope), []).append(result)

    scales: dict[tuple[str, str], ColorScale] = {}
    for members in grouped.values():
        rdf_values: list[np.ndarray] = []
        sensitivity_values: list[np.ndarray] = []
        for result in members:
            valid_rdf = result.rdf[result.valid]
            rdf_values.append(valid_rdf[np.isfinite(valid_rdf)])
            finite_sensitivity = result.sensitivity[np.isfinite(result.sensitivity)]
            sensitivity_values.append(np.abs(finite_sensitivity))
        nonempty_rdf = [values for values in rdf_values if values.size]
        nonempty_sensitivity = [values for values in sensitivity_values if values.size]
        all_rdf = np.concatenate(nonempty_rdf) if nonempty_rdf else np.array([1.0])
        all_sensitivity = (
            np.concatenate(nonempty_sensitivity)
            if nonempty_sensitivity
            else np.array([0.0])
        )
        rdf_vmax = max(1.01, float(np.percentile(all_rdf, rdf_percentile)))
        sensitivity_limit = max(
            1e-6,
            float(np.percentile(all_sensitivity, sensitivity_percentile)),
        )
        scale = ColorScale(
            rdf_vmax=rdf_vmax,
            rdf_true_max=float(np.max(all_rdf)),
            sensitivity_limit=sensitivity_limit,
            sensitivity_true_max=float(np.max(all_sensitivity)),
        )
        for result in members:
            scales[(result.component, result.pair_file)] = scale
    return scales


def plot_pair(
    result: PairResult,
    pressure_unit: str,
    pdf: PdfPages,
    output_dir: Path,
    dpi: int,
    peak_range: tuple[float, float],
    color_scale: ColorScale,
) -> Path:
    pressure_factor = PRESSURE_FACTORS[pressure_unit]
    pressures = result.pressures_pa * pressure_factor
    pressure_edges = logarithmic_edges(pressures)
    distance_edges = linear_edges(result.distance)
    display_rdf = result.rdf.copy()
    display_rdf[~result.valid] = np.nan

    fig = plt.figure(figsize=(12.4, 9.2), constrained_layout=True)
    grid = fig.add_gridspec(3, 3, height_ratios=(1.0, 1.0, 0.72))
    ax_g = fig.add_subplot(grid[0, :])
    ax_d = fig.add_subplot(grid[1, :], sharex=ax_g, sharey=ax_g)
    ax_peak_r = fig.add_subplot(grid[2, 0])
    ax_peak_g = fig.add_subplot(grid[2, 1], sharex=ax_peak_r)
    ax_shell = fig.add_subplot(grid[2, 2], sharex=ax_peak_r)

    mesh_g = ax_g.pcolormesh(
        distance_edges,
        pressure_edges,
        np.ma.masked_invalid(display_rdf),
        shading="flat",
        cmap=configured_colormap("viridis", over="#ff7f0e"),
        norm=TwoSlopeNorm(vmin=0.0, vcenter=1.0, vmax=color_scale.rdf_vmax),
        rasterized=True,
    )
    colorbar_g = fig.colorbar(mesh_g, ax=ax_g, pad=0.012, extend="max")
    colorbar_g.set_label(r"$g(r)$")
    colorbar_g.ax.set_title(f"max {color_scale.rdf_true_max:.3g}", fontsize=8)

    mesh_d = ax_d.pcolormesh(
        distance_edges,
        pressure_edges,
        np.ma.masked_invalid(result.sensitivity),
        shading="flat",
        cmap=configured_colormap(
            "RdBu_r",
            over="#4b004b",
            under="#003300",
        ),
        vmin=-color_scale.sensitivity_limit,
        vmax=color_scale.sensitivity_limit,
        rasterized=True,
    )
    colorbar_d = fig.colorbar(mesh_d, ax=ax_d, pad=0.012, extend="both")
    colorbar_d.set_label(r"$\partial g(r)/\partial\log_{10}P$")
    colorbar_d.ax.set_title(
        f"max |.| {color_scale.sensitivity_true_max:.3g}",
        fontsize=8,
    )

    for axis in (ax_g, ax_d):
        axis.set_yscale("log")
        axis.set_ylabel(f"Pressure ({pressure_unit})")
        axis.tick_params(which="both", direction="in", top=True, right=True)
    ax_g.set_xlabel(r"Distance, $r$ ($\AA$)")
    ax_d.set_xlabel(r"Distance, $r$ ($\AA$)")
    ax_g.set_title(f"{result.component}: {result.pair_label}")

    valid = result.valid
    ax_peak_r.plot(
        pressures[valid],
        result.peak_distance[valid],
        marker="o",
        markersize=2.8,
        linewidth=1.2,
    )
    ax_peak_g.plot(
        pressures[valid],
        result.peak_height[valid],
        marker="o",
        markersize=2.8,
        linewidth=1.2,
        color="tab:orange",
    )
    ax_shell.plot(
        pressures[valid],
        result.shell_excess_area[valid],
        marker="o",
        markersize=2.8,
        linewidth=1.2,
        color="tab:green",
    )
    for axis in (ax_peak_r, ax_peak_g, ax_shell):
        axis.set_xscale("log")
        axis.set_xlabel(f"Pressure ({pressure_unit})")
        axis.grid(True, which="major", alpha=0.25, linewidth=0.5)
        axis.tick_params(which="both", direction="in", top=True, right=True)
    ax_peak_r.set_ylabel(r"Peak distance ($\AA$)")
    ax_peak_g.set_ylabel(r"Peak $g(r)$")
    ax_shell.set_ylabel(r"$\int \max[g(r)-1,0]\,dr$")
    ax_peak_g.set_title(
        f"Tracked peak height, {peak_range[0]:g}–{peak_range[1]:g} Å"
    )
    ax_peak_r.set_title(
        f"Tracked peak position, {peak_range[0]:g}–{peak_range[1]:g} Å"
    )
    ax_shell.set_title("Fixed-shell excess area above $g(r)=1$")

    if result.sampling_cutoff_pa is not None:
        cutoff_display = result.sampling_cutoff_pa * pressure_factor
        for axis in (ax_g, ax_d):
            axis.axhline(cutoff_display, color="black", linestyle=":", linewidth=0.9)
        fig.suptitle(
            f"Gray rows excluded below {cutoff_display:.4g} {pressure_unit}; "
            f"pair-specific raw-count jump = {result.sampling_jump_decades:.2f} decades",
            fontsize=9,
        )

    output_path = output_dir / "pairs" / f"{safe_name(result.component)}_{safe_name(pair_stem(result.pair_file))}.png"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=dpi, bbox_inches="tight")
    pdf.savefig(fig, bbox_inches="tight")
    plt.close(fig)
    return output_path


def overview_matches(result: PairResult, requested: Sequence[str]) -> bool:
    normalized = pair_stem(result.pair_file).casefold()
    return any(normalized == item.casefold().removeprefix("rdf_").removesuffix(".dat") for item in requested)


def plot_overview(
    results: Sequence[PairResult],
    requested_pairs: Sequence[str],
    pressure_unit: str,
    output_dir: Path,
    dpi: int,
    kind: str,
    rdf_percentile: float,
    sensitivity_percentile: float,
) -> Path | None:
    selected = [result for result in results if overview_matches(result, requested_pairs)]
    if not selected:
        return None
    selected = selected[:4]
    rows = 1 if len(selected) <= 2 else 2
    columns = min(2, len(selected))
    fig, axes = plt.subplots(
        rows,
        columns,
        figsize=(6.4 * columns, 4.2 * rows),
        squeeze=False,
        constrained_layout=True,
    )
    arrays = []
    for result in selected:
        values = result.rdf.copy() if kind == "rdf" else result.sensitivity.copy()
        values[~result.valid] = np.nan
        arrays.append(values)
    if kind == "rdf":
        limit = finite_percentile(
            np.concatenate([a.ravel() for a in arrays]),
            rdf_percentile,
            1.01,
        )
        norm = TwoSlopeNorm(vmin=0.0, vcenter=1.0, vmax=limit)
        vmin, vmax, cmap, color_label, extend = None, None, "viridis", r"$g(r)$", "max"
    else:
        limit = finite_percentile(
            np.abs(np.concatenate([a.ravel() for a in arrays])),
            sensitivity_percentile,
            1e-6,
        )
        norm = None
        vmin, vmax, cmap, color_label, extend = (
            -limit,
            limit,
            "RdBu_r",
            r"$\partial g(r)/\partial\log_{10}P$",
            "both",
        )
    pressure_factor = PRESSURE_FACTORS[pressure_unit]
    mesh = None
    for axis, result, values in zip(axes.flat, selected, arrays):
        pressure = result.pressures_pa * pressure_factor
        cmap_object = (
            configured_colormap(cmap, over="#ff7f0e")
            if kind == "rdf"
            else configured_colormap(cmap, over="#4b004b", under="#003300")
        )
        plot_kwargs = {"norm": norm} if norm is not None else {"vmin": vmin, "vmax": vmax}
        mesh = axis.pcolormesh(
            linear_edges(result.distance),
            logarithmic_edges(pressure),
            np.ma.masked_invalid(values),
            shading="flat",
            cmap=cmap_object,
            rasterized=True,
            **plot_kwargs,
        )
        axis.set_yscale("log")
        axis.set_xlabel(r"Distance, $r$ ($\AA$)")
        axis.set_ylabel(f"Pressure ({pressure_unit})")
        axis.set_title(result.pair_label)
        axis.tick_params(which="both", direction="in", top=True, right=True)
    for axis in list(axes.flat)[len(selected):]:
        axis.set_visible(False)
    assert mesh is not None
    colorbar = fig.colorbar(
        mesh,
        ax=list(axes.flat)[: len(selected)],
        pad=0.015,
        extend=extend,
    )
    colorbar.set_label(color_label)
    title_word = "RDF" if kind == "rdf" else "pressure sensitivity"
    fig.suptitle(f"{selected[0].component} {title_word} overview")
    output_path = output_dir / f"{safe_name(selected[0].component)}_RDF_overview_{kind}.png"
    fig.savefig(output_path, dpi=dpi, bbox_inches="tight")
    fig.savefig(output_path.with_suffix(".pdf"), bbox_inches="tight")
    plt.close(fig)
    return output_path


def write_pressure_summary(output_dir: Path, results: Sequence[PairResult], pressure_unit: str) -> Path:
    path = output_dir / "rdf_pressure_summary.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            (
                "component",
                "pair",
                "run_pressure_pa",
                f"pressure_{pressure_unit}",
                "valid_for_analysis",
                "raw_histogram_sum",
                "first_prominent_peak_distance_A",
                "first_prominent_peak_height",
                "shell_excess_centroid_A",
                "shell_excess_area_A",
                "sensitivity_rms",
            )
        )
        factor = PRESSURE_FACTORS[pressure_unit]
        for result in results:
            for index, pressure_pa in enumerate(result.pressures_pa):
                writer.writerow(
                    (
                        result.component,
                        pair_stem(result.pair_file),
                        f"{pressure_pa:.16g}",
                        f"{pressure_pa * factor:.16g}",
                        int(result.valid[index]),
                        f"{result.raw_sums[index]:.16g}",
                        "" if not np.isfinite(result.peak_distance[index]) else f"{result.peak_distance[index]:.10g}",
                        "" if not np.isfinite(result.peak_height[index]) else f"{result.peak_height[index]:.10g}",
                        "" if not np.isfinite(result.shell_centroid[index]) else f"{result.shell_centroid[index]:.10g}",
                        "" if not np.isfinite(result.shell_excess_area[index]) else f"{result.shell_excess_area[index]:.10g}",
                        "" if not np.isfinite(result.sensitivity_rms[index]) else f"{result.sensitivity_rms[index]:.10g}",
                    )
                )
    return path


def write_pair_summary(output_dir: Path, results: Sequence[PairResult]) -> Path:
    path = output_dir / "rdf_pair_summary.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            (
                "component",
                "pair",
                "pressure_count",
                "valid_pressure_count",
                "max_sensitivity_rms",
                "pressure_pa_at_max_sensitivity",
                "min_peak_distance_A",
                "max_peak_distance_A",
                "min_peak_height",
                "max_peak_height",
                "max_shell_excess_area_A",
                "pair_sampling_cutoff_pa",
                "pair_sampling_jump_decades",
            )
        )
        for result in results:
            finite_sensitivity = np.isfinite(result.sensitivity_rms)
            if np.any(finite_sensitivity):
                indices = np.flatnonzero(finite_sensitivity)
                local = int(np.nanargmax(result.sensitivity_rms[finite_sensitivity]))
                max_index = int(indices[local])
                max_sensitivity = result.sensitivity_rms[max_index]
                max_pressure = result.pressures_pa[max_index]
            else:
                max_sensitivity = np.nan
                max_pressure = np.nan
            writer.writerow(
                (
                    result.component,
                    pair_stem(result.pair_file),
                    len(result.pressures_pa),
                    int(np.count_nonzero(result.valid)),
                    "" if not np.isfinite(max_sensitivity) else f"{max_sensitivity:.10g}",
                    "" if not np.isfinite(max_pressure) else f"{max_pressure:.16g}",
                    f"{np.nanmin(result.peak_distance):.10g}",
                    f"{np.nanmax(result.peak_distance):.10g}",
                    f"{np.nanmin(result.peak_height):.10g}",
                    f"{np.nanmax(result.peak_height):.10g}",
                    f"{np.nanmax(result.shell_excess_area):.10g}",
                    "" if result.sampling_cutoff_pa is None else f"{result.sampling_cutoff_pa:.16g}",
                    f"{result.sampling_jump_decades:.10g}",
                )
            )
    return path


def plot_summary_matrix(
    results: Sequence[PairResult],
    pressure_unit: str,
    output_dir: Path,
    dpi: int,
) -> Path | None:
    """Summarize reliable effect size and its pressure across the chain series."""
    components = sorted({result.component for result in results}, key=natural_sort_key)
    pairs = sorted({pair_stem(result.pair_file) for result in results}, key=natural_sort_key)
    if len(components) < 2 or not pairs:
        return None
    component_index = {value: index for index, value in enumerate(components)}
    pair_index = {value: index for index, value in enumerate(pairs)}
    effect = np.full((len(pairs), len(components)), np.nan)
    pressure = np.full_like(effect, np.nan)
    factor = PRESSURE_FACTORS[pressure_unit]
    for result in results:
        finite = np.isfinite(result.sensitivity_rms)
        if not np.any(finite):
            continue
        valid_indices = np.flatnonzero(finite)
        result_index = int(valid_indices[np.nanargmax(result.sensitivity_rms[finite])])
        row = pair_index[pair_stem(result.pair_file)]
        column = component_index[result.component]
        effect[row, column] = result.sensitivity_rms[result_index]
        pressure[row, column] = result.pressures_pa[result_index] * factor

    if not np.any(np.isfinite(effect)):
        return None
    figure_height = max(5.0, 0.34 * len(pairs) + 1.8)
    fig, axes = plt.subplots(
        1,
        2,
        figsize=(max(10.0, 0.7 * len(components) + 7.0), figure_height),
        constrained_layout=True,
    )
    effect_limit = finite_percentile(effect, 99.0, 1e-6)
    effect_mesh = axes[0].imshow(
        np.ma.masked_invalid(effect),
        aspect="auto",
        interpolation="nearest",
        cmap=configured_colormap("magma", over="#00ffff"),
        vmin=0.0,
        vmax=effect_limit,
    )
    fig.colorbar(effect_mesh, ax=axes[0], extend="max").set_label("Maximum sensitivity RMS")

    log_pressure = np.log10(pressure)
    pressure_mesh = axes[1].imshow(
        np.ma.masked_invalid(log_pressure),
        aspect="auto",
        interpolation="nearest",
        cmap=configured_colormap("viridis"),
    )
    pressure_colorbar = fig.colorbar(pressure_mesh, ax=axes[1])
    pressure_colorbar.set_label(f"log10 pressure ({pressure_unit}) at maximum")
    for axis, title in zip(
        axes,
        ("Largest reliable pressure response", "Pressure of largest response"),
    ):
        axis.set_xticks(np.arange(len(components)), components, rotation=45, ha="right")
        axis.set_yticks(np.arange(len(pairs)), [pair_label(pair) for pair in pairs])
        axis.set_xlabel("Component")
        axis.set_title(title)
    fig.suptitle("RDF chain-series overview")
    output_path = output_dir / "RDF_chain_series_overview.png"
    fig.savefig(output_path, dpi=dpi, bbox_inches="tight")
    fig.savefig(output_path.with_suffix(".pdf"), bbox_inches="tight")
    plt.close(fig)
    return output_path


def write_readme(
    output_dir: Path,
    results: Sequence[PairResult],
    pressure_unit: str,
    args: argparse.Namespace,
) -> Path:
    path = output_dir / "README.txt"
    components = ", ".join(sorted({result.component for result in results}))
    lines = [
        "RASPA RDF pressure-map analysis",
        "",
        f"Components: {components}",
        f"RDF pair count: {len(results)}",
        f"Pressure display unit: {pressure_unit}",
        f"Distance smoothing window for sensitivity/peaks: {args.smooth_distance_bins} bins",
        f"Local-linear sensitivity window: {args.smooth_pressure_points} pressure points",
        f"Tracked peak search: {args.peak_range[0]} to {args.peak_range[1]} A",
        f"Minimum local peak prominence: {args.peak_prominence}",
        f"Peak prominence comparison window: {args.peak_prominence_window} A",
        f"Maximum tracked peak jump: {args.peak_max_jump} A",
        f"RDF color scale: {args.rdf_percentile}th percentile, scope={args.color_scale_scope}, centered at g(r)=1",
        f"Sensitivity color scale: symmetric {args.sensitivity_percentile}th percentile, scope={args.color_scale_scope}",
        "Orange RDF pixels and dark sensitivity pixels are clipped beyond the robust color limit.",
        "Each color bar reports the true maximum retained value.",
        "",
        "The top heatmap is the normalized RDF g(r, P).",
        "The second heatmap is a centered local-linear estimate of d g / d log10(P).",
        "Rows without a complete regression window are omitted to avoid derivative edge artifacts.",
        "Red and blue therefore mean opposite directions of structural change; white means little change.",
        "The peak tracker follows the nearest prominent peak and will leave a gap instead of jumping to a distant shoulder.",
        "Fixed-shell excess area integrates max(g(r)-1, 0) over the selected peak range.",
        "This is pressure sensitivity, not statistical significance.",
        "Block uncertainties or independent replicates are required for significance testing.",
        "",
        "Sampling masks are calculated separately for every RDF pair from that pair's raw histogram counts.",
        f"Minimum raw histogram sum: {args.min_raw_sum}",
        f"Minimum fraction of that pair's maximum raw sum: {args.min_raw_fraction}",
    ]
    masked_pairs = [result for result in results if result.sampling_cutoff_pa is not None]
    lines.append(
        f"Pair-specific count jumps masked low-pressure rows for {len(masked_pairs)} of {len(results)} RDF pairs."
    )
    lines.append(
        "Masked rows are gray and remain listed as valid_for_analysis=0 in the pressure CSV."
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="RDF collection directory, manifest.csv, or tar archive")
    parser.add_argument("--output", type=Path, default=Path("RDF_pressure_heatmaps"), help="Output directory")
    parser.add_argument("--component", help="Only analyze one component, such as C10")
    parser.add_argument("--pairs", nargs="*", default=[], help="Optional pair-name substrings to include")
    parser.add_argument("--pressure-unit", choices=tuple(PRESSURE_FACTORS), default="bar")
    parser.add_argument("--peak-range", nargs=2, type=float, default=(2.5, 7.5), metavar=("RMIN", "RMAX"))
    parser.add_argument("--smooth-distance-bins", type=int, default=5)
    parser.add_argument("--smooth-pressure-points", type=int, default=5)
    parser.add_argument("--peak-prominence", type=float, default=0.015)
    parser.add_argument("--peak-prominence-window", type=float, default=0.6, help="Local baseline window in angstrom")
    parser.add_argument("--peak-max-jump", type=float, default=0.75, help="Maximum pressure-to-pressure tracked peak shift in angstrom")
    parser.add_argument("--sampling-jump-decades", type=float, default=1.0, help="Mask pressures below a pair-specific raw-count jump of at least this size; 0 disables")
    parser.add_argument("--min-raw-sum", type=float, default=0.0, help="Additional per-pair raw-histogram sum threshold")
    parser.add_argument("--min-raw-fraction", type=float, default=0.0, help="Mask rows below this fraction of the same pair's maximum raw count")
    parser.add_argument("--color-scale-scope", choices=("family", "global", "pair"), default="family", help="Share robust color limits by exact RDF pair across components, globally, or not at all")
    parser.add_argument("--rdf-percentile", type=float, default=99.0, help="Robust upper percentile for g(r) color limits")
    parser.add_argument("--sensitivity-percentile", type=float, default=99.0, help="Robust percentile for symmetric sensitivity color limits")
    parser.add_argument(
        "--overview-pairs",
        nargs="*",
        default=(
            "CH2_sp3_H1",
            "CH2_sp3_O1",
            "CH2_sp3_Zn1",
            "CH2_sp3_C1",
            "CF2_sp3_H1",
            "CF2_sp3_O1",
            "CF2_sp3_Zn1",
            "CF2_sp3_C1",
        ),
    )
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--zip", action="store_true", help="Also create a zip archive of the output directory")
    return parser.parse_args()


def main() -> int:
    args = parse_arguments()
    if args.peak_range[0] >= args.peak_range[1]:
        print("ERROR: --peak-range requires RMIN < RMAX", file=sys.stderr)
        return 2
    if not 0 < args.rdf_percentile <= 100 or not 0 < args.sensitivity_percentile <= 100:
        print("ERROR: color percentiles must be in (0, 100]", file=sys.stderr)
        return 2
    if not 0 <= args.min_raw_fraction <= 1:
        print("ERROR: --min-raw-fraction must be between 0 and 1", file=sys.stderr)
        return 2
    if args.peak_max_jump <= 0:
        print("ERROR: --peak-max-jump must be positive", file=sys.stderr)
        return 2
    output_dir = args.output.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        with materialized_collection(args.input) as manifest:
            records = read_manifest(manifest, args.component)
            grouped = group_records(records, args.pairs)
            results: list[PairResult] = []
            grouped_items = sorted(
                grouped.items(),
                key=lambda item: (
                    natural_sort_key(item[0][0]),
                    natural_sort_key(item[0][1]),
                ),
            )
            for (component, pair_file), pair_records in grouped_items:
                result = build_pair_result(
                    component=component,
                    pair_file=pair_file,
                    records=pair_records,
                    sampling_jump_decades=args.sampling_jump_decades,
                    min_raw_sum=args.min_raw_sum,
                    min_raw_fraction=args.min_raw_fraction,
                    smooth_distance_bins=args.smooth_distance_bins,
                    smooth_pressure_points=args.smooth_pressure_points,
                    peak_range=tuple(args.peak_range),
                    peak_prominence=args.peak_prominence,
                    peak_prominence_window=args.peak_prominence_window,
                    peak_max_jump=args.peak_max_jump,
                )
                results.append(result)

            color_scales = compute_color_scales(
                results,
                args.color_scale_scope,
                args.rdf_percentile,
                args.sensitivity_percentile,
            )

            report_pdf = output_dir / "RDF_pressure_heatmaps.pdf"
            with PdfPages(report_pdf) as pdf:
                for index, result in enumerate(results, start=1):
                    image_path = plot_pair(
                        result=result,
                        pressure_unit=args.pressure_unit,
                        pdf=pdf,
                        output_dir=output_dir,
                        dpi=args.dpi,
                        peak_range=tuple(args.peak_range),
                        color_scale=color_scales[(result.component, result.pair_file)],
                    )
                    print(f"[{index:02d}/{len(results):02d}] {result.pair_file} -> {image_path}")

            pressure_summary = write_pressure_summary(output_dir, results, args.pressure_unit)
            pair_summary = write_pair_summary(output_dir, results)
            readme = write_readme(
                output_dir,
                results,
                args.pressure_unit,
                args,
            )
            overview_rdf = plot_overview(
                results,
                args.overview_pairs,
                args.pressure_unit,
                output_dir,
                args.dpi,
                "rdf",
                args.rdf_percentile,
                args.sensitivity_percentile,
            )
            overview_sensitivity = plot_overview(
                results,
                args.overview_pairs,
                args.pressure_unit,
                output_dir,
                args.dpi,
                "sensitivity",
                args.rdf_percentile,
                args.sensitivity_percentile,
            )
            summary_matrix = plot_summary_matrix(
                results,
                args.pressure_unit,
                output_dir,
                args.dpi,
            )

        archive_path = None
        if args.zip:
            archive_path = Path(
                shutil.make_archive(
                    str(output_dir),
                    "zip",
                    root_dir=output_dir.parent,
                    base_dir=output_dir.name,
                )
            )

        print(f"\nPairs analyzed: {len(results)}")
        print(f"Report PDF: {report_pdf}")
        print(f"Pressure summary: {pressure_summary}")
        print(f"Pair summary: {pair_summary}")
        print(f"Methods/QC: {readme}")
        if overview_rdf:
            print(f"RDF overview: {overview_rdf}")
        if overview_sensitivity:
            print(f"Sensitivity overview: {overview_sensitivity}")
        if summary_matrix:
            print(f"Chain-series overview: {summary_matrix}")
        masked_pair_count = sum(result.sampling_cutoff_pa is not None for result in results)
        print(f"Pair-specific low-count masks applied: {masked_pair_count}/{len(results)}")
        if archive_path:
            print(f"Output archive: {archive_path}")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
