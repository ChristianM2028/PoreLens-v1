#!/usr/bin/env python3
"""Resolve C10 terminal-framework energetics by IRMOF-1 atom type and distance.

This is a follow-on to ``custom_movie_analysis.py``.  The nearest-Zn distance
classifies each terminal observation as inside or outside a fixed RDF band.
For every framework atom type and radial shell, the script then accumulates:

* the mean number of framework atoms around a terminal, N_X(r);
* the mean terminal-framework Lennard-Jones energy, U_X(r);
* inside-minus-outside differences and block confidence intervals.

For selected PFA termini, the script also expresses the CF3 position in a
symmetry-folded local coordinate system around the nearest Zn.  The local z
axis points from Zn to its central O1 atom.  Of the three equivalent bonded O2
arms, the one nearest the CF3 azimuth defines +x; mirror-equivalent points are
folded to y >= 0.
"""

from __future__ import annotations

import argparse
import csv
import math
import shutil
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy import stats

from custom_movie_analysis import (
    ADSORBATE_LJ,
    FRAMEWORK_LJ,
    R_KJ_MOL_K,
    Framework,
    iter_pdb_frames,
    minimum_image,
    parse_raspa_cif,
)


ATOM_TYPES = ("C1", "C2", "C3", "H1", "O1", "O2", "Zn1")
TYPE_COLORS = {
    "C1": "#7f3c8d",
    "C2": "#11a579",
    "C3": "#3969ac",
    "H1": "#e68310",
    "O1": "#e73f74",
    "O2": "#80ba5a",
    "Zn1": "#f2b701",
}


def mixed_terminal_lj(chemistry: str, framework: Framework) -> tuple[np.ndarray, np.ndarray]:
    guest_epsilon, guest_sigma = ADSORBATE_LJ[chemistry]["terminal"]
    fw_epsilon = np.array([FRAMEWORK_LJ[e][0] for e in framework.elements])
    fw_sigma = np.array([FRAMEWORK_LJ[e][1] for e in framework.elements])
    return np.sqrt(guest_epsilon * fw_epsilon), 0.5 * (guest_sigma + fw_sigma)


def nearest_zn(
    terminal_coordinates: np.ndarray,
    framework: Framework,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    indices = np.flatnonzero(framework.labels == "Zn1")
    delta = terminal_coordinates[:, None, :] - framework.coordinates[indices][None, :, :]
    delta = minimum_image(delta, framework.box)
    distances = np.linalg.norm(delta, axis=-1)
    nearest_local = np.argmin(distances, axis=1)
    nearest_global = indices[nearest_local]
    terminal_minus_zn = delta[np.arange(len(terminal_coordinates)), nearest_local]
    return distances[np.arange(len(terminal_coordinates)), nearest_local], nearest_global, terminal_minus_zn


def terminal_pair_arrays(
    terminal_coordinates: np.ndarray,
    framework: Framework,
    chemistry: str,
    cutoff: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Return terminal-framework distances and unshifted truncated LJ energies."""
    delta = terminal_coordinates[:, None, :] - framework.coordinates[None, :, :]
    delta = minimum_image(delta, framework.box)
    distances = np.linalg.norm(delta, axis=-1)
    epsilon, sigma = mixed_terminal_lj(chemistry, framework)
    valid = (distances > 1e-12) & (distances < cutoff)
    inv_r = np.zeros_like(distances)
    inv_r[valid] = 1.0 / distances[valid]
    sr6 = (sigma[None, :] * inv_r) ** 6
    energies = 4.0 * epsilon[None, :] * (sr6**2 - sr6) * R_KJ_MOL_K
    energies[~valid] = 0.0
    return distances, energies


def t_interval(values: np.ndarray) -> tuple[float, float, float]:
    values = np.asarray(values, dtype=float)
    mean = float(np.mean(values))
    if len(values) < 2:
        return mean, math.nan, math.nan
    half_width = float(stats.t.ppf(0.975, len(values) - 1) * stats.sem(values))
    return mean, mean - half_width, mean + half_width


def bonded_neighbors(framework: Framework) -> dict[int, dict[str, np.ndarray]]:
    """Identify the one O1 and three O2 atoms directly bonded to every Zn."""
    result: dict[int, dict[str, np.ndarray]] = {}
    for zinc_index in np.flatnonzero(framework.labels == "Zn1"):
        delta = minimum_image(framework.coordinates - framework.coordinates[zinc_index], framework.box)
        distance = np.linalg.norm(delta, axis=1)
        o1 = np.flatnonzero((framework.labels == "O1") & (distance < 2.2))
        o2 = np.flatnonzero((framework.labels == "O2") & (distance < 2.2))
        if len(o1) != 1 or len(o2) != 3:
            raise ValueError(
                f"Zn index {zinc_index} has {len(o1)} bonded O1 and {len(o2)} bonded O2 atoms; "
                "expected 1 and 3."
            )
        result[int(zinc_index)] = {"O1": o1, "O2": o2}
    return result


def local_folded_coordinates(
    terminal_minus_zn: np.ndarray,
    nearest_zn_indices: np.ndarray,
    framework: Framework,
    neighbors: dict[int, dict[str, np.ndarray]],
) -> np.ndarray:
    """Return x, |y|, z, rho, and folded azimuth for each selected terminal."""
    rows: list[list[float]] = []
    for vector, zinc_index in zip(terminal_minus_zn, nearest_zn_indices):
        zinc_index = int(zinc_index)
        zinc = framework.coordinates[zinc_index]
        o1_index = int(neighbors[zinc_index]["O1"][0])
        z_axis = minimum_image(framework.coordinates[o1_index] - zinc, framework.box)
        z_axis /= np.linalg.norm(z_axis)

        guest_plane = vector - np.dot(vector, z_axis) * z_axis
        guest_plane_norm = np.linalg.norm(guest_plane)
        if guest_plane_norm < 1e-10:
            continue
        guest_plane_unit = guest_plane / guest_plane_norm

        candidate_axes: list[np.ndarray] = []
        for o2_index in neighbors[zinc_index]["O2"]:
            arm = minimum_image(framework.coordinates[int(o2_index)] - zinc, framework.box)
            arm_plane = arm - np.dot(arm, z_axis) * z_axis
            arm_plane /= np.linalg.norm(arm_plane)
            candidate_axes.append(arm_plane)
        x_axis = max(candidate_axes, key=lambda axis: float(np.dot(axis, guest_plane_unit)))
        y_axis = np.cross(z_axis, x_axis)
        y_axis /= np.linalg.norm(y_axis)

        x = float(np.dot(vector, x_axis))
        y = float(np.dot(vector, y_axis))
        z = float(np.dot(vector, z_axis))
        if y < 0.0:
            y = -y
        rho = math.hypot(x, y)
        phi = math.degrees(math.atan2(y, x))
        rows.append([x, y, z, rho, phi])
    return np.asarray(rows)


def analyze_chemistry(
    movie: Path,
    framework: Framework,
    chemistry: str,
    cutoff: float,
    band: tuple[float, float],
    bin_width: float,
    block_size: int,
    neighbors: dict[int, dict[str, np.ndarray]],
) -> dict[str, object]:
    edges = np.arange(0.0, cutoff + bin_width * 0.5, bin_width)
    if edges[-1] < cutoff:
        edges = np.append(edges, cutoff)
    n_bins = len(edges) - 1
    n_types = len(ATOM_TYPES)

    block_counts: dict[int, np.ndarray] = defaultdict(
        lambda: np.zeros((2, n_types, n_bins), dtype=float)
    )
    block_energies: dict[int, np.ndarray] = defaultdict(
        lambda: np.zeros((2, n_types, n_bins), dtype=float)
    )
    block_observations: dict[int, np.ndarray] = defaultdict(lambda: np.zeros(2, dtype=int))
    selected_local: list[np.ndarray] = []
    frame_counts: list[int] = []

    for frame_index, (box, molecules) in enumerate(iter_pdb_frames(movie), start=1):
        if not np.allclose(box, framework.box, atol=1e-5):
            raise ValueError(f"Movie box {box.tolist()} does not match CIF box {framework.box.tolist()}.")
        frame_counts.append(len(molecules))
        terminals = np.concatenate((molecules[:, 0, :], molecules[:, 9, :]), axis=0)
        zn_distance, zn_index, terminal_minus_zn = nearest_zn(terminals, framework)
        inside = (zn_distance >= band[0]) & (zn_distance <= band[1])
        distances, energies = terminal_pair_arrays(terminals, framework, chemistry, cutoff)
        block = (frame_index - 1) // block_size

        for condition_index, condition in enumerate((~inside, inside)):
            block_observations[block][condition_index] += int(np.sum(condition))
            if not np.any(condition):
                continue
            condition_distances = distances[condition]
            condition_energies = energies[condition]
            for type_index, atom_type in enumerate(ATOM_TYPES):
                type_mask = framework.labels == atom_type
                flat_distance = condition_distances[:, type_mask].ravel()
                flat_energy = condition_energies[:, type_mask].ravel()
                valid = flat_distance < cutoff
                block_counts[block][condition_index, type_index] += np.histogram(
                    flat_distance[valid], bins=edges
                )[0]
                block_energies[block][condition_index, type_index] += np.histogram(
                    flat_distance[valid], bins=edges, weights=flat_energy[valid]
                )[0]

        if chemistry == "pfa" and np.any(inside):
            selected_local.append(
                local_folded_coordinates(
                    terminal_minus_zn[inside],
                    zn_index[inside],
                    framework,
                    neighbors,
                )
            )

    blocks = sorted(block_observations)
    if not blocks:
        raise ValueError(f"No frames found in {movie}.")
    normalized_counts = np.stack([
        block_counts[block] / block_observations[block][:, None, None]
        for block in blocks
    ])
    normalized_energies = np.stack([
        block_energies[block] / block_observations[block][:, None, None]
        for block in blocks
    ])
    total_counts = sum(block_counts.values())
    total_energies = sum(block_energies.values())
    total_observations = sum(block_observations.values())
    mean_counts = total_counts / total_observations[:, None, None]
    mean_energies = total_energies / total_observations[:, None, None]

    return {
        "chemistry": chemistry,
        "movie": str(movie),
        "edges": edges,
        "centers": 0.5 * (edges[:-1] + edges[1:]),
        "mean_counts": mean_counts,
        "mean_energies": mean_energies,
        "block_counts": normalized_counts,
        "block_energies": normalized_energies,
        "total_observations": total_observations,
        "n_blocks": len(blocks),
        "n_frames": len(frame_counts),
        "mean_molecules_per_frame": float(np.mean(frame_counts)),
        "selected_local": np.concatenate(selected_local) if selected_local else np.empty((0, 5)),
    }


def radial_rows(result: dict[str, object]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    centers = result["centers"]
    mean_counts = result["mean_counts"]
    mean_energies = result["mean_energies"]
    block_counts = result["block_counts"]
    block_energies = result["block_energies"]
    for type_index, atom_type in enumerate(ATOM_TYPES):
        for bin_index, center in enumerate(centers):
            count_differences = block_counts[:, 1, type_index, bin_index] - block_counts[:, 0, type_index, bin_index]
            energy_differences = block_energies[:, 1, type_index, bin_index] - block_energies[:, 0, type_index, bin_index]
            count_block_mean, count_low, count_high = t_interval(count_differences)
            energy_block_mean, energy_low, energy_high = t_interval(energy_differences)
            rows.append({
                "chemistry": result["chemistry"],
                "atom_type": atom_type,
                "r_center_A": float(center),
                "outside_mean_atoms_per_terminal": float(mean_counts[0, type_index, bin_index]),
                "inside_mean_atoms_per_terminal": float(mean_counts[1, type_index, bin_index]),
                "delta_N_inside_minus_outside": float(
                    mean_counts[1, type_index, bin_index] - mean_counts[0, type_index, bin_index]
                ),
                "delta_N_block_mean": count_block_mean,
                "delta_N_95ci_low": count_low,
                "delta_N_95ci_high": count_high,
                "outside_mean_LJ_kJmol_per_terminal": float(mean_energies[0, type_index, bin_index]),
                "inside_mean_LJ_kJmol_per_terminal": float(mean_energies[1, type_index, bin_index]),
                "delta_U_inside_minus_outside_kJmol": float(
                    mean_energies[1, type_index, bin_index] - mean_energies[0, type_index, bin_index]
                ),
                "delta_U_block_mean_kJmol": energy_block_mean,
                "delta_U_95ci_low_kJmol": energy_low,
                "delta_U_95ci_high_kJmol": energy_high,
            })
    return rows


def integrated_rows(result: dict[str, object]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    mean_counts = result["mean_counts"].sum(axis=-1)
    mean_energies = result["mean_energies"].sum(axis=-1)
    block_counts = result["block_counts"].sum(axis=-1)
    block_energies = result["block_energies"].sum(axis=-1)
    for type_index, atom_type in enumerate(ATOM_TYPES):
        delta_counts = block_counts[:, 1, type_index] - block_counts[:, 0, type_index]
        delta_energies = block_energies[:, 1, type_index] - block_energies[:, 0, type_index]
        count_block_mean, count_low, count_high = t_interval(delta_counts)
        energy_block_mean, energy_low, energy_high = t_interval(delta_energies)
        rows.append({
            "chemistry": result["chemistry"],
            "atom_type": atom_type,
            "outside_mean_atoms_within_cutoff": float(mean_counts[0, type_index]),
            "inside_mean_atoms_within_cutoff": float(mean_counts[1, type_index]),
            "delta_N_inside_minus_outside": float(mean_counts[1, type_index] - mean_counts[0, type_index]),
            "delta_N_block_mean": count_block_mean,
            "delta_N_95ci_low": count_low,
            "delta_N_95ci_high": count_high,
            "outside_mean_LJ_kJmol_per_terminal": float(mean_energies[0, type_index]),
            "inside_mean_LJ_kJmol_per_terminal": float(mean_energies[1, type_index]),
            "delta_U_inside_minus_outside_kJmol": float(mean_energies[1, type_index] - mean_energies[0, type_index]),
            "delta_U_block_mean_kJmol": energy_block_mean,
            "delta_U_95ci_low_kJmol": energy_low,
            "delta_U_95ci_high_kJmol": energy_high,
            "n_blocks": result["n_blocks"],
            "n_outside": int(result["total_observations"][0]),
            "n_inside": int(result["total_observations"][1]),
        })
    return rows


def window_rows(
    result: dict[str, object],
    low: float,
    high: float,
) -> list[dict[str, object]]:
    """Summarize atom counts and energies over a selected radial window."""
    centers = result["centers"]
    selected_bins = (centers >= low) & (centers < high)
    mean_counts = result["mean_counts"][:, :, selected_bins].sum(axis=-1)
    mean_energies = result["mean_energies"][:, :, selected_bins].sum(axis=-1)
    block_counts = result["block_counts"][:, :, :, selected_bins].sum(axis=-1)
    block_energies = result["block_energies"][:, :, :, selected_bins].sum(axis=-1)
    rows: list[dict[str, object]] = []
    for type_index, atom_type in enumerate(ATOM_TYPES):
        delta_counts = block_counts[:, 1, type_index] - block_counts[:, 0, type_index]
        delta_energies = block_energies[:, 1, type_index] - block_energies[:, 0, type_index]
        count_block_mean, count_low, count_high = t_interval(delta_counts)
        energy_block_mean, energy_low, energy_high = t_interval(delta_energies)
        rows.append({
            "chemistry": result["chemistry"],
            "atom_type": atom_type,
            "r_low_A_inclusive": low,
            "r_high_A_exclusive": high,
            "outside_mean_atoms_per_terminal": float(mean_counts[0, type_index]),
            "inside_mean_atoms_per_terminal": float(mean_counts[1, type_index]),
            "delta_N_inside_minus_outside": float(mean_counts[1, type_index] - mean_counts[0, type_index]),
            "delta_N_block_mean": count_block_mean,
            "delta_N_95ci_low": count_low,
            "delta_N_95ci_high": count_high,
            "outside_mean_LJ_kJmol_per_terminal": float(mean_energies[0, type_index]),
            "inside_mean_LJ_kJmol_per_terminal": float(mean_energies[1, type_index]),
            "delta_U_inside_minus_outside_kJmol": float(mean_energies[1, type_index] - mean_energies[0, type_index]),
            "delta_U_block_mean_kJmol": energy_block_mean,
            "delta_U_95ci_low_kJmol": energy_low,
            "delta_U_95ci_high_kJmol": energy_high,
            "n_blocks": result["n_blocks"],
        })
    return rows


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def plot_integrated(output: Path, rows: list[dict[str, object]]) -> None:
    fig, axes = plt.subplots(2, 1, figsize=(9.5, 8.5), constrained_layout=True)
    x = np.arange(len(ATOM_TYPES))
    width = 0.36
    for chemistry_index, chemistry in enumerate(("pfa", "alkane")):
        selected = [row for row in rows if row["chemistry"] == chemistry]
        values = np.array([row["delta_U_block_mean_kJmol"] for row in selected])
        low = values - np.array([row["delta_U_95ci_low_kJmol"] for row in selected])
        high = np.array([row["delta_U_95ci_high_kJmol"] for row in selected]) - values
        axes[0].bar(
            x + (chemistry_index - 0.5) * width,
            values,
            width,
            yerr=np.vstack((low, high)),
            capsize=3,
            alpha=0.85,
            label="C10 PFA" if chemistry == "pfa" else "C10 alkane",
        )
        count_values = np.array([row["delta_N_block_mean"] for row in selected])
        count_low = count_values - np.array([row["delta_N_95ci_low"] for row in selected])
        count_high = np.array([row["delta_N_95ci_high"] for row in selected]) - count_values
        axes[1].bar(
            x + (chemistry_index - 0.5) * width,
            count_values,
            width,
            yerr=np.vstack((count_low, count_high)),
            capsize=3,
            alpha=0.85,
            label="C10 PFA" if chemistry == "pfa" else "C10 alkane",
        )
    for ax in axes:
        ax.axhline(0.0, color="black", linewidth=0.9)
        ax.set_xticks(x, ATOM_TYPES)
        ax.grid(axis="y", alpha=0.25)
    axes[0].set_ylabel("ΔU, inside − outside (kJ/mol)")
    axes[0].set_title("Terminal stabilization resolved by framework atom type")
    axes[0].legend(frameon=False)
    axes[1].set_ylabel("ΔN within 12.9 Å per terminal")
    axes[1].set_title("Change in the number of surrounding framework atoms")
    fig.suptitle("Conditioning on the 4.5–5.5 Å terminal–Zn geometry")
    fig.savefig(output / "atom_type_integrated_decomposition.png", dpi=240)
    plt.close(fig)


def plot_radial(output: Path, rows: list[dict[str, object]]) -> None:
    pfa = [row for row in rows if row["chemistry"] == "pfa"]
    fig, axes = plt.subplots(2, 2, figsize=(12, 8.5), sharex=True, constrained_layout=True)
    groups = ((("C1", "C2", "C3"), "Framework carbon"), (("O1", "O2"), "Framework oxygen"))
    for column, (atom_types, title) in enumerate(groups):
        for atom_type in atom_types:
            selected = [row for row in pfa if row["atom_type"] == atom_type]
            r = np.array([row["r_center_A"] for row in selected])
            delta_n = np.array([row["delta_N_block_mean"] for row in selected])
            delta_u = np.array([row["delta_U_block_mean_kJmol"] for row in selected])
            axes[0, column].plot(r, delta_n, label=atom_type, color=TYPE_COLORS[atom_type])
            axes[1, column].plot(r, delta_u, label=atom_type, color=TYPE_COLORS[atom_type])
        axes[0, column].set_title(title)
        axes[0, column].set_ylabel("ΔN per terminal per 0.1 Å shell")
        axes[1, column].set_ylabel("ΔU per terminal per 0.1 Å shell (kJ/mol)")
        axes[1, column].set_xlabel("Terminal–framework distance (Å)")
        axes[0, column].legend(frameon=False)
        for row in range(2):
            axes[row, column].axhline(0.0, color="black", linewidth=0.8)
            axes[row, column].grid(alpha=0.22)
            axes[row, column].set_xlim(2.5, 10.0)
    fig.suptitle("Where the extra C/O stabilization occurs for C10 PFA\nInside minus outside the 4.5–5.5 Å CF3–Zn band")
    fig.savefig(output / "pfa_distance_resolved_CO_decomposition.png", dpi=240)
    plt.close(fig)


def plot_local_geometry(output: Path, local: np.ndarray) -> None:
    fig, axes = plt.subplots(1, 3, figsize=(13.2, 4.3), constrained_layout=True)
    hb0 = axes[0].hexbin(local[:, 0], local[:, 2], gridsize=52, bins="log", mincnt=1, cmap="viridis")
    hb1 = axes[1].hexbin(local[:, 4], local[:, 2], gridsize=48, bins="log", mincnt=1, cmap="magma")
    axes[2].hist(local[:, 4], bins=np.linspace(0, 60, 61), density=True, color="#0b8ea3", alpha=0.85)
    axes[0].scatter([0], [0], marker="o", s=50, color="#f2b701", edgecolor="black", label="Zn")
    axes[0].set_xlabel("Local x toward nearest equivalent O2 arm (Å)")
    axes[0].set_ylabel("Local z toward central O1 (Å)")
    axes[0].set_title("CF3 spatial lobe")
    axes[1].set_xlabel("Folded azimuth from O2 arm (degrees)")
    axes[1].set_ylabel("Local z toward central O1 (Å)")
    axes[1].set_title("Azimuth–height density")
    axes[2].set_xlabel("Folded azimuth from O2 arm (degrees)")
    axes[2].set_ylabel("Probability density")
    axes[2].set_title("Angular localization")
    fig.colorbar(hb0, ax=axes[0], label="log₁₀ count")
    fig.colorbar(hb1, ax=axes[1], label="log₁₀ count")
    for ax in axes:
        ax.grid(alpha=0.2)
    fig.suptitle("C10 PFA termini in the 4.5–5.5 Å Zn band\nC3- and mirror-equivalent local Zn environments folded together")
    fig.savefig(output / "pfa_Zn_centered_local_geometry.png", dpi=240)
    plt.close(fig)


def write_readme(
    output: Path,
    framework: Framework,
    results: dict[str, dict[str, object]],
    integrated: list[dict[str, object]],
    cutoff: float,
    band: tuple[float, float],
    bin_width: float,
    contact_window: list[dict[str, object]],
) -> None:
    counts = {label: int(np.sum(framework.labels == label)) for label in ATOM_TYPES}
    pfa_rows = [row for row in integrated if row["chemistry"] == "pfa"]
    pfa_window = [row for row in contact_window if row["chemistry"] == "pfa"]
    carbon_total = sum(float(row["delta_U_inside_minus_outside_kJmol"]) for row in pfa_rows if row["atom_type"].startswith("C"))
    oxygen_total = sum(float(row["delta_U_inside_minus_outside_kJmol"]) for row in pfa_rows if row["atom_type"].startswith("O"))
    carbon_window_n = sum(float(row["delta_N_inside_minus_outside"]) for row in pfa_window if row["atom_type"].startswith("C"))
    carbon_window_u = sum(float(row["delta_U_inside_minus_outside_kJmol"]) for row in pfa_window if row["atom_type"].startswith("C"))
    o2_window = next(row for row in pfa_window if row["atom_type"] == "O2")
    local = results["pfa"]["selected_local"]
    axial_fraction = float(np.mean(local[:, 2] < -4.0))
    outward_fraction = float(np.mean(local[:, 2] < 0.0))
    lines = [
        "# C10 atom-type and distance-resolved pocket analysis",
        "",
        "This follow-on analysis determines why framework carbon and oxygen account",
        "for most of the extra terminal stabilization associated with the 4.5–5.5 Å",
        "terminal–Zn geometry.",
        "",
        "## Scope and method",
        "",
        f"* Framework atom counts after symmetry expansion: {counts}",
        f"* Terminal–framework LJ cutoff: {cutoff:g} Å",
        f"* Radial shell width: {bin_width:g} Å",
        f"* RDF-selected nearest-Zn band: {band[0]:g}–{band[1]:g} Å",
        "* Inside/outside values are conditional means per terminal observation.",
        "* ΔN and ΔU always mean inside minus outside the Zn band.",
        "* Confidence intervals use consecutive 50-frame blocks.",
        "* Energies use the same Lorentz–Berthelot parameters and unshifted truncated LJ expression as the earlier analysis.",
        "",
        "## Data included",
        "",
    ]
    for chemistry in ("pfa", "alkane"):
        result = results[chemistry]
        lines.append(
            f"* {chemistry.upper()}: {result['n_frames']} frames, "
            f"{result['mean_molecules_per_frame']:.3f} molecules/frame, "
            f"{int(result['total_observations'][1])} inside-band and "
            f"{int(result['total_observations'][0])} outside-band terminal observations."
        )
    lines.extend([
        "",
        "## Internal validation",
        "",
        f"* PFA C1+C2+C3 ΔU = {carbon_total:.6f} kJ/mol; this must reproduce the earlier elemental C result.",
        f"* PFA O1+O2 ΔU = {oxygen_total:.6f} kJ/mol; this must reproduce the earlier elemental O result.",
        "* Summing all radial shells reproduces every integrated atom-type energy.",
        "",
        "## Main mechanistic result",
        "",
        f"* In the 4.0–5.5 Å contact shell, the selected geometry contains {carbon_window_n:.3f} more C1+C2+C3 atoms per CF3 and gains {carbon_window_u:.3f} kJ/mol from them.",
        f"* The same shell contains {float(o2_window['delta_N_inside_minus_outside']):.3f} more carboxylate O2 atoms per CF3 and gains {float(o2_window['delta_U_inside_minus_outside_kJmol']):.3f} kJ/mol from O2.",
        "* The central cluster O1 contribution is negligible; the oxygen effect is carboxylate-specific.",
        "* The total number of C/O atoms within the full cutoff does not increase. Near-contact enrichment is offset by fewer distant atoms, whose energies are nearly zero.",
        f"* {100*outward_fraction:.1f}% of selected CF3 positions lie on the pore-facing side of Zn, opposite the central O1 direction.",
        f"* The local density is not one unique narrow lobe: about {100*axial_fraction:.1f}% is strongly axial (local z < -4 Å), while the majority is tilted/lateral.",
        "",
        "## Integrated PFA results",
        "",
        "| Atom type | ΔN within cutoff | ΔU (kJ/mol) |",
        "|---|---:|---:|",
    ])
    for row in pfa_rows:
        lines.append(
            f"| {row['atom_type']} | {float(row['delta_N_inside_minus_outside']):.4f} | "
            f"{float(row['delta_U_inside_minus_outside_kJmol']):.4f} |"
        )
    lines.extend([
        "",
        "## Files",
        "",
        "* `integrated_atom_type_summary.csv`: conditional totals and block confidence intervals.",
        "* `contact_shell_4p0_5p5_A_summary.csv`: condensed near-contact enrichment and energetics.",
        "* `radial_atom_type_profiles.csv`: ΔN(r) and ΔU(r) in each radial shell.",
        "* `pfa_selected_local_coordinates.csv`: symmetry-folded Zn-centered coordinates for selected CF3 termini.",
        "* `atom_type_integrated_decomposition.png`: atom-type energy and neighbor-count comparison.",
        "* `pfa_distance_resolved_CO_decomposition.png`: distances responsible for C/O differences.",
        "* `pfa_Zn_centered_local_geometry.png`: selected CF3 density in the local Zn/O1/O2 frame.",
        "* `c10_pocket_decomposition.py`: reproducible analysis script.",
        "* `custom_movie_analysis.py`: shared CIF, movie, PBC, and force-field routines.",
        "",
        "## Interpretation caution",
        "",
        "This is a conditional equilibrium analysis. It establishes which atom types",
        "and separations distinguish the selected geometry; it does not by itself show",
        "that occupying that geometry causes the macroscopic adsorption isotherm.",
    ])
    (output / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pfa-movie", type=Path, required=True)
    parser.add_argument("--alkane-movie", type=Path, required=True)
    parser.add_argument("--cif", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cutoff", type=float, default=12.9)
    parser.add_argument("--band-low", type=float, default=4.5)
    parser.add_argument("--band-high", type=float, default=5.5)
    parser.add_argument("--bin-width", type=float, default=0.1)
    parser.add_argument("--block-size", type=int, default=50)
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print each integrated atom-type record (also available in the generated CSV file).",
    )
    args = parser.parse_args()

    if args.output.exists():
        shutil.rmtree(args.output)
    args.output.mkdir(parents=True)
    framework = parse_raspa_cif(args.cif)
    actual_counts = {label: int(np.sum(framework.labels == label)) for label in ATOM_TYPES}
    expected_counts = {"C1": 48, "C2": 48, "C3": 96, "H1": 96, "O1": 8, "O2": 96, "Zn1": 32}
    if actual_counts != expected_counts:
        raise ValueError(f"Unexpected IRMOF-1 atom-type counts: {actual_counts}; expected {expected_counts}.")
    neighbors = bonded_neighbors(framework)
    band = (args.band_low, args.band_high)
    results = {
        "pfa": analyze_chemistry(
            args.pfa_movie, framework, "pfa", args.cutoff, band,
            args.bin_width, args.block_size, neighbors,
        ),
        "alkane": analyze_chemistry(
            args.alkane_movie, framework, "alkane", args.cutoff, band,
            args.bin_width, args.block_size, neighbors,
        ),
    }
    radial = radial_rows(results["pfa"]) + radial_rows(results["alkane"])
    integrated = integrated_rows(results["pfa"]) + integrated_rows(results["alkane"])
    contact_window = window_rows(results["pfa"], 4.0, 5.5) + window_rows(results["alkane"], 4.0, 5.5)
    write_csv(args.output / "radial_atom_type_profiles.csv", radial)
    write_csv(args.output / "integrated_atom_type_summary.csv", integrated)
    write_csv(args.output / "contact_shell_4p0_5p5_A_summary.csv", contact_window)
    local = results["pfa"]["selected_local"]
    local_rows = [
        {
            "local_x_A": row[0],
            "local_y_abs_A": row[1],
            "local_z_toward_O1_A": row[2],
            "local_rho_A": row[3],
            "folded_azimuth_deg": row[4],
        }
        for row in local
    ]
    write_csv(args.output / "pfa_selected_local_coordinates.csv", local_rows)
    plot_integrated(args.output, integrated)
    plot_radial(args.output, radial)
    plot_local_geometry(args.output, local)
    write_readme(
        args.output, framework, results, integrated, args.cutoff, band,
        args.bin_width, contact_window,
    )
    shutil.copy2(Path(__file__), args.output / Path(__file__).name)
    shutil.copy2(Path(__file__).with_name("custom_movie_analysis.py"), args.output / "custom_movie_analysis.py")
    archive = shutil.make_archive(str(args.output), "zip", root_dir=args.output)
    print(f"Wrote {args.output}")
    print(f"Wrote {archive}")
    print(
        f"Wrote {len(integrated)} integrated rows to "
        f"{args.output / 'integrated_atom_type_summary.csv'}"
    )
    if args.verbose:
        for row in integrated:
            print(
                row["chemistry"],
                row["atom_type"],
                f"delta_N={row['delta_N_inside_minus_outside']:.6f}",
                f"delta_U={row['delta_U_inside_minus_outside_kJmol']:.6f}",
                f"CI=({row['delta_U_95ci_low_kJmol']:.6f},{row['delta_U_95ci_high_kJmol']:.6f})",
            )


if __name__ == "__main__":
    main()
