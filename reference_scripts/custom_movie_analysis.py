#!/usr/bin/env python3
"""Conditional whole-chain analysis for RASPA C10 movie PDB files.

The movie files contain adsorbate united-atom coordinates only. Framework
coordinates are symmetry-expanded from a RASPA CIF. For every molecule/frame,
this script calculates:

* each terminal site's nearest-Zn distance;
* end-to-end distance after minimum-image chain unwrapping;
* framework Lennard-Jones energy of every united-atom site;
* total backbone (sites 2--9) framework LJ energy;
* counts of backbone sites below several LJ-energy thresholds.

Terminal observations are then conditioned on whether their nearest-Zn
distance is in the selected 4.5--5.5 A band.
"""

from __future__ import annotations

import argparse
import csv
import math
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy import stats


R_KJ_MOL_K = 0.00831446261815324

FRAMEWORK_LJ = {
    "C": (52.84, 3.43),
    "H": (22.14, 2.57),
    "O": (30.19, 3.12),
    "Zn": (62.3992, 2.46),
}

ADSORBATE_LJ = {
    "pfa": {
        "terminal": (87.0, 4.36),
        "backbone": (27.5, 4.73),
        "terminal_name": "CF3",
        "backbone_name": "CF2",
    },
    "alkane": {
        "terminal": (98.0, 3.75),
        "backbone": (46.0, 3.95),
        "terminal_name": "CH3",
        "backbone_name": "CH2",
    },
}


@dataclass
class Framework:
    box: np.ndarray
    coordinates: np.ndarray
    elements: np.ndarray
    labels: np.ndarray


def _eval_symmetry_component(expr: str, x: float, y: float, z: float) -> float:
    if not re.fullmatch(r"[xyzXYZ0-9+\-*/. ]+", expr):
        raise ValueError(f"Unsupported CIF symmetry expression: {expr!r}")
    return float(eval(expr, {"__builtins__": {}}, {"x": x, "y": y, "z": z}))


def parse_raspa_cif(path: Path) -> Framework:
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    values: dict[str, float] = {}
    for line in lines:
        parts = line.split()
        if len(parts) >= 2 and parts[0] in {
            "_cell_length_a",
            "_cell_length_b",
            "_cell_length_c",
            "_cell_angle_alpha",
            "_cell_angle_beta",
            "_cell_angle_gamma",
        }:
            values[parts[0]] = float(parts[1])
    if any(abs(values.get(k, 0.0) - 90.0) > 1e-8 for k in (
        "_cell_angle_alpha", "_cell_angle_beta", "_cell_angle_gamma"
    )):
        raise ValueError("This analysis currently expects an orthorhombic cell.")
    box = np.array([
        values["_cell_length_a"],
        values["_cell_length_b"],
        values["_cell_length_c"],
    ])

    sym_start = next(
        i for i, line in enumerate(lines)
        if line.strip() in {"_symmetry_equiv_pos_as_xyz", "_space_group_symop_operation_xyz"}
    )
    operations: list[str] = []
    for line in lines[sym_start + 1:]:
        stripped = line.strip()
        if stripped.startswith("loop_") or stripped.startswith("_atom_site_"):
            break
        if not stripped:
            continue
        if stripped[0] in {"'", '"'}:
            operations.append(stripped.strip("'\""))
    if not operations:
        raise ValueError("No symmetry operations found in CIF.")

    charge_header = next(i for i, line in enumerate(lines) if line.strip() == "_atom_site_charge")
    asymmetric_sites: list[tuple[str, str, np.ndarray]] = []
    for line in lines[charge_header + 1:]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = stripped.split()
        if len(parts) < 5:
            continue
        label, element = parts[0], parts[1]
        try:
            frac = np.array([float(parts[2]), float(parts[3]), float(parts[4])])
        except ValueError:
            continue
        asymmetric_sites.append((label, element, frac))
    if not asymmetric_sites:
        raise ValueError("No atom sites found in CIF.")

    expanded: dict[tuple[str, int, int, int], tuple[str, str, np.ndarray]] = {}
    for label, element, frac in asymmetric_sites:
        x, y, z = frac
        for operation in operations:
            components = operation.split(",")
            if len(components) != 3:
                raise ValueError(f"Invalid symmetry operation: {operation!r}")
            transformed = np.array([
                _eval_symmetry_component(component, x, y, z)
                for component in components
            ]) % 1.0
            key = (label, *np.rint(transformed * 10**8).astype(int))
            expanded[key] = (label, element, transformed)

    labels = np.array([item[0] for item in expanded.values()])
    elements = np.array([item[1] for item in expanded.values()])
    fractional = np.array([item[2] for item in expanded.values()])
    return Framework(
        box=box,
        coordinates=fractional * box,
        elements=elements,
        labels=labels,
    )


def iter_pdb_frames(path: Path):
    coordinates: list[list[float]] = []
    box = None
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if line.startswith("CRYST1"):
                lengths = np.array([
                    float(line[6:15]),
                    float(line[15:24]),
                    float(line[24:33]),
                ])
                angles = np.array([
                    float(line[33:40]),
                    float(line[40:47]),
                    float(line[47:54]),
                ])
                if np.any(np.abs(angles - 90.0) > 1e-6):
                    raise ValueError("This analysis currently expects an orthorhombic PDB box.")
                if box is None:
                    box = lengths
                elif not np.allclose(box, lengths, atol=1e-6):
                    raise ValueError("PDB box changes between frames.")
            elif line.startswith(("ATOM  ", "HETATM")):
                coordinates.append([
                    float(line[30:38]),
                    float(line[38:46]),
                    float(line[46:54]),
                ])
            elif line.startswith("ENDMDL"):
                if box is None:
                    raise ValueError("No CRYST1 record found before ENDMDL.")
                array = np.asarray(coordinates, dtype=float)
                if len(array) % 10:
                    raise ValueError(
                        f"Frame has {len(array)} sites; expected a multiple of 10."
                    )
                yield box.copy(), array.reshape(-1, 10, 3)
                coordinates = []


def minimum_image(delta: np.ndarray, box: np.ndarray) -> np.ndarray:
    return delta - box * np.rint(delta / box)


def unwrap_chain(chain: np.ndarray, box: np.ndarray) -> np.ndarray:
    unwrapped = np.empty_like(chain)
    unwrapped[0] = chain[0]
    for site in range(1, len(chain)):
        step = minimum_image(chain[site] - chain[site - 1], box)
        unwrapped[site] = unwrapped[site - 1] + step
    return unwrapped


def mixed_lj(guest: tuple[float, float], framework_elements: np.ndarray):
    guest_epsilon, guest_sigma = guest
    fw_epsilon = np.array([FRAMEWORK_LJ[e][0] for e in framework_elements])
    fw_sigma = np.array([FRAMEWORK_LJ[e][1] for e in framework_elements])
    epsilon = np.sqrt(guest_epsilon * fw_epsilon)
    sigma = 0.5 * (guest_sigma + fw_sigma)
    return epsilon, sigma


def site_framework_energies(
    guest_coordinates: np.ndarray,
    framework: Framework,
    chemistry: str,
    cutoff: float,
) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Return total and element-resolved framework LJ energies [kJ/mol]."""
    delta = guest_coordinates[:, :, None, :] - framework.coordinates[None, None, :, :]
    delta = minimum_image(delta, framework.box)
    r2 = np.einsum("...i,...i->...", delta, delta)
    energies = np.zeros(guest_coordinates.shape[:2], dtype=float)
    contributions = {
        element: np.zeros(guest_coordinates.shape[:2], dtype=float)
        for element in ("C", "H", "O", "Zn")
    }

    for site in range(10):
        kind = "terminal" if site in (0, 9) else "backbone"
        epsilon, sigma = mixed_lj(ADSORBATE_LJ[chemistry][kind], framework.elements)
        distances2 = r2[:, site, :]
        mask = (distances2 > 1e-12) & (distances2 < cutoff**2)
        inv_r2 = np.zeros_like(distances2)
        inv_r2[mask] = 1.0 / distances2[mask]
        sr6 = (sigma[None, :] ** 2 * inv_r2) ** 3
        pair_energy_k = 4.0 * epsilon[None, :] * (sr6**2 - sr6)
        pair_energy_k[~mask] = 0.0
        energies[:, site] = pair_energy_k.sum(axis=1) * R_KJ_MOL_K
        for element in contributions:
            element_mask = framework.elements == element
            contributions[element][:, site] = (
                pair_energy_k[:, element_mask].sum(axis=1) * R_KJ_MOL_K
            )
    return energies, contributions


def nearest_element_geometry(
    coordinates: np.ndarray,
    framework: Framework,
    element: str,
) -> tuple[np.ndarray, np.ndarray]:
    targets = framework.coordinates[framework.elements == element]
    delta = coordinates[:, None, :] - targets[None, :, :]
    delta = minimum_image(delta, framework.box)
    distances = np.sqrt(np.einsum("...i,...i->...", delta, delta))
    nearest = np.argmin(distances, axis=1)
    # Return the vector from the guest site to the nearest framework atom.
    guest_to_target = -delta[np.arange(len(coordinates)), nearest]
    return distances[np.arange(len(coordinates)), nearest], guest_to_target


def lj_pair_energy(
    distances: np.ndarray,
    guest_parameters: tuple[float, float],
    framework_parameters: tuple[float, float],
) -> np.ndarray:
    guest_epsilon, guest_sigma = guest_parameters
    fw_epsilon, fw_sigma = framework_parameters
    epsilon = math.sqrt(guest_epsilon * fw_epsilon)
    sigma = 0.5 * (guest_sigma + fw_sigma)
    sr6 = (sigma / distances) ** 6
    return 4.0 * epsilon * (sr6**2 - sr6) * R_KJ_MOL_K


def analyze_movie(
    movie: Path,
    framework: Framework,
    chemistry: str,
    cutoff: float,
    band: tuple[float, float],
) -> tuple[list[dict[str, float]], list[dict[str, float]], dict[str, object]]:
    molecule_rows: list[dict[str, float]] = []
    terminal_rows: list[dict[str, float]] = []
    frame_counts: list[int] = []
    thresholds = (-0.5, -1.0, -2.0)

    for frame_index, (box, molecules) in enumerate(iter_pdb_frames(movie), start=1):
        if not np.allclose(box, framework.box, atol=1e-5):
            raise ValueError(
                f"PDB box {box.tolist()} does not match CIF box {framework.box.tolist()}."
            )
        frame_counts.append(len(molecules))
        site_energies, element_energies = site_framework_energies(
            molecules, framework, chemistry, cutoff
        )
        termini = np.concatenate([molecules[:, 0, :], molecules[:, 9, :]], axis=0)
        terminal_distances_flat, terminal_to_zn_flat = nearest_element_geometry(
            termini, framework, "Zn"
        )
        terminal_distances = np.column_stack([
            terminal_distances_flat[:len(molecules)],
            terminal_distances_flat[len(molecules):],
        ])
        terminal_to_zn = np.stack([
            terminal_to_zn_flat[:len(molecules)],
            terminal_to_zn_flat[len(molecules):],
        ], axis=1)
        terminal_pair_energies_flat = lj_pair_energy(
            terminal_distances_flat,
            ADSORBATE_LJ[chemistry]["terminal"],
            FRAMEWORK_LJ["Zn"],
        )
        terminal_pair_energies = np.column_stack([
            terminal_pair_energies_flat[:len(molecules)],
            terminal_pair_energies_flat[len(molecules):],
        ])

        for molecule_index, chain in enumerate(molecules):
            unwrapped = unwrap_chain(chain, box)
            end_to_end = float(np.linalg.norm(unwrapped[-1] - unwrapped[0]))
            backbone_energies = site_energies[molecule_index, 1:9]
            backbone_total = float(backbone_energies.sum())
            terminal_total = float(
                site_energies[molecule_index, 0] + site_energies[molecule_index, 9]
            )
            distances = terminal_distances[molecule_index]
            in_band = (distances >= band[0]) & (distances <= band[1])
            terminal_site_energies = np.array([
                site_energies[molecule_index, 0],
                site_energies[molecule_index, 9],
            ])
            inward_vectors = np.array([
                minimum_image(chain[1] - chain[0], box),
                minimum_image(chain[8] - chain[9], box),
            ])
            cos_angles = np.einsum(
                "ij,ij->i",
                inward_vectors,
                terminal_to_zn[molecule_index],
            ) / (
                np.linalg.norm(inward_vectors, axis=1)
                * np.linalg.norm(terminal_to_zn[molecule_index], axis=1)
            )
            row: dict[str, float] = {
                "frame": frame_index,
                "molecule": molecule_index + 1,
                "n_molecules_frame": len(molecules),
                "terminal_1_nearest_Zn_A": float(distances[0]),
                "terminal_2_nearest_Zn_A": float(distances[1]),
                "n_terminals_in_band": int(in_band.sum()),
                "any_terminal_in_band": int(in_band.any()),
                "end_to_end_A": end_to_end,
                "backbone_framework_LJ_kJmol": backbone_total,
                "terminal_framework_LJ_kJmol": terminal_total,
                "molecule_framework_LJ_kJmol": float(site_energies[molecule_index].sum()),
            }
            for threshold in thresholds:
                row[f"n_backbone_sites_U_lt_{abs(threshold):g}_kJmol"] = int(
                    np.sum(backbone_energies < threshold)
                )
            for site in range(10):
                row[f"site_{site + 1}_framework_LJ_kJmol"] = float(
                    site_energies[molecule_index, site]
                )
            for element in ("C", "H", "O", "Zn"):
                row[f"backbone_framework_{element}_LJ_kJmol"] = float(
                    element_energies[element][molecule_index, 1:9].sum()
                )
            molecule_rows.append(row)

            for terminal_number, distance in enumerate(distances, start=1):
                terminal_rows.append({
                    "frame": frame_index,
                    "molecule": molecule_index + 1,
                    "terminal": terminal_number,
                    "nearest_Zn_A": float(distance),
                    "in_4p5_5p5_A_band": int(band[0] <= distance <= band[1]),
                    "terminal_framework_LJ_kJmol": float(
                        terminal_site_energies[terminal_number - 1]
                    ),
                    "terminal_nearest_Zn_pair_LJ_kJmol": float(
                        terminal_pair_energies[molecule_index, terminal_number - 1]
                    ),
                    "cos_chain_inward_vs_terminal_to_Zn": float(
                        cos_angles[terminal_number - 1]
                    ),
                    "end_to_end_A": end_to_end,
                    "backbone_framework_LJ_kJmol": backbone_total,
                    "molecule_framework_LJ_kJmol": float(site_energies[molecule_index].sum()),
                    "n_backbone_sites_U_lt_0p5_kJmol": int(
                        np.sum(backbone_energies < -0.5)
                    ),
                    "n_backbone_sites_U_lt_1_kJmol": int(
                        np.sum(backbone_energies < -1.0)
                    ),
                    "n_backbone_sites_U_lt_2_kJmol": int(
                        np.sum(backbone_energies < -2.0)
                    ),
                    **{
                        f"terminal_framework_{element}_LJ_kJmol": float(
                            element_energies[element][
                                molecule_index,
                                0 if terminal_number == 1 else 9,
                            ]
                        )
                        for element in ("C", "H", "O", "Zn")
                    },
                    **{
                        f"backbone_framework_{element}_LJ_kJmol": float(
                            element_energies[element][molecule_index, 1:9].sum()
                        )
                        for element in ("C", "H", "O", "Zn")
                    },
                })

    metadata = {
        "chemistry": chemistry,
        "movie": str(movie),
        "n_frames": len(frame_counts),
        "mean_molecules_per_frame": float(np.mean(frame_counts)),
        "min_molecules_per_frame": int(np.min(frame_counts)),
        "max_molecules_per_frame": int(np.max(frame_counts)),
        "n_molecule_observations": len(molecule_rows),
        "n_terminal_observations": len(terminal_rows),
    }
    return molecule_rows, terminal_rows, metadata


def write_csv(path: Path, rows: list[dict[str, float]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def block_statistics(
    rows: list[dict[str, float]],
    value: str,
    category: str,
    block_size: int = 50,
) -> dict[str, float]:
    frames = np.array([int(row["frame"]) for row in rows])
    values = np.array([float(row[value]) for row in rows])
    categories = np.array([bool(row[category]) for row in rows])
    blocks = (frames - 1) // block_size
    differences: list[float] = []
    for block in np.unique(blocks):
        selected = blocks == block
        inside = values[selected & categories]
        outside = values[selected & ~categories]
        if len(inside) and len(outside):
            differences.append(float(inside.mean() - outside.mean()))
    array = np.asarray(differences)
    if len(array) > 1:
        sem = stats.sem(array)
        critical = stats.t.ppf(0.975, len(array) - 1)
        ci_low = float(array.mean() - critical * sem)
        ci_high = float(array.mean() + critical * sem)
    else:
        ci_low = ci_high = math.nan
    return {
        "inside_mean": float(values[categories].mean()),
        "outside_mean": float(values[~categories].mean()),
        "difference_inside_minus_outside": float(values[categories].mean() - values[~categories].mean()),
        "block_mean_difference": float(array.mean()),
        "block_95ci_low": ci_low,
        "block_95ci_high": ci_high,
        "n_blocks": len(array),
        "n_inside": int(categories.sum()),
        "n_outside": int((~categories).sum()),
    }


def summarize(
    chemistry: str,
    molecule_rows: list[dict[str, float]],
    terminal_rows: list[dict[str, float]],
    metadata: dict[str, object],
) -> tuple[list[dict[str, object]], dict[str, object]]:
    metrics = [
        ("terminal_framework_LJ_kJmol", "Terminal-framework LJ energy", "kJ/mol"),
        ("terminal_framework_C_LJ_kJmol", "Terminal-framework C LJ energy", "kJ/mol"),
        ("terminal_framework_H_LJ_kJmol", "Terminal-framework H LJ energy", "kJ/mol"),
        ("terminal_framework_O_LJ_kJmol", "Terminal-framework O LJ energy", "kJ/mol"),
        ("terminal_framework_Zn_LJ_kJmol", "Terminal-framework Zn LJ energy", "kJ/mol"),
        ("terminal_nearest_Zn_pair_LJ_kJmol", "Terminal-nearest-Zn pair LJ energy", "kJ/mol"),
        ("cos_chain_inward_vs_terminal_to_Zn", "Terminal orientation cosine", "dimensionless"),
        ("backbone_framework_LJ_kJmol", "Backbone-framework LJ energy", "kJ/mol"),
        ("n_backbone_sites_U_lt_0p5_kJmol", "Backbone sites with U < -0.5 kJ/mol", "sites"),
        ("n_backbone_sites_U_lt_1_kJmol", "Backbone sites with U < -1.0 kJ/mol", "sites"),
        ("n_backbone_sites_U_lt_2_kJmol", "Backbone sites with U < -2.0 kJ/mol", "sites"),
        ("end_to_end_A", "End-to-end distance", "A"),
    ]
    summary_rows: list[dict[str, object]] = []
    for key, label, unit in metrics:
        result = block_statistics(
            terminal_rows, key, "in_4p5_5p5_A_band"
        )
        summary_rows.append({
            "chemistry": chemistry,
            "metric": label,
            "unit": unit,
            **result,
        })

    distances = np.array([row["nearest_Zn_A"] for row in terminal_rows])
    in_band = np.array([row["in_4p5_5p5_A_band"] for row in terminal_rows], dtype=bool)
    backbone_energy = np.array([
        row["backbone_framework_LJ_kJmol"] for row in terminal_rows
    ])
    extension = np.array([row["end_to_end_A"] for row in terminal_rows])
    molecule_any_band = np.array([
        row["any_terminal_in_band"] for row in molecule_rows
    ], dtype=bool)
    molecule_both_band = np.array([
        row["n_terminals_in_band"] == 2 for row in molecule_rows
    ])
    overall = {
        **metadata,
        "terminal_band_fraction": float(in_band.mean()),
        "molecules_any_terminal_band_fraction": float(molecule_any_band.mean()),
        "molecules_both_terminals_band_fraction": float(molecule_both_band.mean()),
        "median_terminal_nearest_Zn_A": float(np.median(distances)),
        "median_backbone_framework_LJ_kJmol": float(np.median(backbone_energy)),
        "median_end_to_end_A": float(np.median(extension)),
        "spearman_r_terminal_distance_vs_backbone_energy": float(
            stats.spearmanr(distances, backbone_energy).statistic
        ),
        "spearman_r_terminal_distance_vs_end_to_end": float(
            stats.spearmanr(distances, extension).statistic
        ),
    }
    return summary_rows, overall


def plot_results(
    output: Path,
    all_terminal_rows: dict[str, list[dict[str, float]]],
    all_molecule_rows: dict[str, list[dict[str, float]]],
    summary_rows: list[dict[str, object]],
) -> None:
    colors = {"pfa": "#0b8ea3", "alkane": "#d07a00"}
    labels = {"pfa": "C10 PFA", "alkane": "C10 alkane"}

    fig, axes = plt.subplots(2, 2, figsize=(11, 8.5), constrained_layout=True)
    for row_index, chemistry in enumerate(("pfa", "alkane")):
        rows = all_terminal_rows[chemistry]
        distance = np.array([r["nearest_Zn_A"] for r in rows])
        energy = np.array([r["backbone_framework_LJ_kJmol"] for r in rows])
        extension = np.array([r["end_to_end_A"] for r in rows])
        hb1 = axes[row_index, 0].hexbin(
            distance, energy, gridsize=(55, 45), extent=(2.5, 9.0, -80, 20),
            bins="log", mincnt=1, cmap="viridis"
        )
        hb2 = axes[row_index, 1].hexbin(
            distance, extension, gridsize=(55, 45), extent=(2.5, 9.0, 5.5, 13.5),
            bins="log", mincnt=1, cmap="magma"
        )
        for ax in axes[row_index]:
            ax.axvspan(4.5, 5.5, color="#e84a5f", alpha=0.13)
            ax.set_xlim(2.5, 9.0)
            ax.set_xlabel("Terminal–nearest-Zn distance (Å)")
            ax.set_title(labels[chemistry])
        axes[row_index, 0].set_ylabel("Backbone–framework LJ energy (kJ/mol)")
        axes[row_index, 1].set_ylabel("End-to-end distance (Å)")
        fig.colorbar(hb1, ax=axes[row_index, 0], label="log₁₀ count")
        fig.colorbar(hb2, ax=axes[row_index, 1], label="log₁₀ count")
    fig.suptitle(
        "Whole-chain geometry conditioned on terminal–Zn separation\n"
        "Red band: selected 4.5–5.5 Å terminal geometry",
        fontsize=14,
    )
    fig.savefig(output / "terminal_Zn_vs_whole_chain.png", dpi=220)
    plt.close(fig)

    fig, axes = plt.subplots(1, 3, figsize=(13, 4.3), constrained_layout=True)
    metric_specs = [
        ("backbone_framework_LJ_kJmol", "Backbone–framework LJ energy", "kJ/mol"),
        ("n_backbone_sites_U_lt_1_kJmol", "Strongly engaged backbone sites", "sites with U < −1 kJ/mol"),
        ("end_to_end_A", "End-to-end distance", "Å"),
    ]
    x_positions = np.arange(2)
    width = 0.34
    for ax, (metric_key, title, ylabel) in zip(axes, metric_specs):
        for chemistry_index, chemistry in enumerate(("pfa", "alkane")):
            relevant = [
                row for row in summary_rows
                if row["chemistry"] == chemistry
                and (
                    (metric_key == "backbone_framework_LJ_kJmol" and row["metric"] == "Backbone-framework LJ energy")
                    or (metric_key == "n_backbone_sites_U_lt_1_kJmol" and row["metric"] == "Backbone sites with U < -1.0 kJ/mol")
                    or (metric_key == "end_to_end_A" and row["metric"] == "End-to-end distance")
                )
            ][0]
            means = [relevant["outside_mean"], relevant["inside_mean"]]
            offset = (chemistry_index - 0.5) * width
            ax.bar(
                x_positions + offset, means, width,
                label=labels[chemistry], color=colors[chemistry], alpha=0.85
            )
        ax.set_xticks(x_positions, ["Outside band", "Inside band"])
        ax.set_title(title)
        ax.set_ylabel(ylabel)
        ax.grid(axis="y", alpha=0.25)
    axes[0].legend(frameon=False)
    fig.suptitle("Conditional whole-chain averages for terminal observations")
    fig.savefig(output / "conditional_whole_chain_means.png", dpi=220)
    plt.close(fig)

    fig, axes = plt.subplots(1, 2, figsize=(10.5, 4.4), constrained_layout=True)
    for chemistry in ("pfa", "alkane"):
        rows = all_molecule_rows[chemistry]
        site_energies = np.array([
            [row[f"site_{site}_framework_LJ_kJmol"] for site in range(1, 11)]
            for row in rows
        ])
        frame = np.array([row["frame"] for row in rows])
        block = (frame - 1) // 50
        block_means = np.array([
            site_energies[block == b].mean(axis=0) for b in np.unique(block)
        ])
        mean = block_means.mean(axis=0)
        ci = stats.t.ppf(0.975, len(block_means) - 1) * stats.sem(block_means, axis=0)
        axes[0].plot(range(1, 11), mean, marker="o", color=colors[chemistry], label=labels[chemistry])
        axes[0].fill_between(range(1, 11), mean - ci, mean + ci, color=colors[chemistry], alpha=0.18)

        counts = np.array([row["n_terminals_in_band"] for row in rows])
        fractions = np.array([(counts == k).mean() for k in (0, 1, 2)])
        axes[1].plot((0, 1, 2), fractions, marker="o", linewidth=2, color=colors[chemistry], label=labels[chemistry])
    axes[0].set_xlabel("C10 site position")
    axes[0].set_ylabel("Mean site–framework LJ energy (kJ/mol)")
    axes[0].set_title("Framework stabilization along chain")
    axes[0].set_xticks(range(1, 11))
    axes[0].axvspan(1.5, 9.5, color="gray", alpha=0.08)
    axes[0].grid(alpha=0.25)
    axes[1].set_xlabel("Termini per molecule in 4.5–5.5 Å Zn band")
    axes[1].set_ylabel("Molecule fraction")
    axes[1].set_title("Selected terminal geometry")
    axes[1].set_xticks((0, 1, 2))
    axes[1].grid(alpha=0.25)
    axes[1].legend(frameon=False)
    axes[0].legend(frameon=False)
    fig.savefig(output / "chain_profile_and_terminal_counts.png", dpi=220)
    plt.close(fig)

    fig, axes = plt.subplots(1, 3, figsize=(13, 4.4), constrained_layout=True)
    for chemistry in ("pfa", "alkane"):
        rows = all_terminal_rows[chemistry]
        inside = np.array([bool(r["in_4p5_5p5_A_band"]) for r in rows])
        terminal_energy = np.array([r["terminal_framework_LJ_kJmol"] for r in rows])
        pair_energy = np.array([r["terminal_nearest_Zn_pair_LJ_kJmol"] for r in rows])
        cosine = np.array([r["cos_chain_inward_vs_terminal_to_Zn"] for r in rows])
        axes[0].hist(
            terminal_energy[inside], bins=np.linspace(-12, 2, 80), density=True,
            histtype="step", linewidth=2, color=colors[chemistry], label=labels[chemistry]
        )
        axes[1].hist(
            pair_energy[inside], bins=np.linspace(-0.8, 0.2, 80), density=True,
            histtype="step", linewidth=2, color=colors[chemistry], label=labels[chemistry]
        )
        axes[2].hist(
            cosine[inside], bins=np.linspace(-1, 1, 61), density=True,
            histtype="step", linewidth=2, color=colors[chemistry], label=labels[chemistry]
        )
    axes[0].set_xlabel("Terminal–framework LJ energy (kJ/mol)")
    axes[0].set_ylabel("Probability density")
    axes[0].set_title("Full framework environment")
    axes[1].set_xlabel("Terminal–nearest-Zn pair LJ energy (kJ/mol)")
    axes[1].set_ylabel("Probability density")
    axes[1].set_title("Isolated nearest-Zn contribution")
    axes[2].set_xlabel("cos(chain inward vector, terminal→Zn)")
    axes[2].set_ylabel("Probability density")
    axes[2].set_title("Terminal orientation")
    axes[2].legend(frameon=False)
    for ax in axes:
        ax.grid(alpha=0.25)
    fig.suptitle("Properties within the selected 4.5–5.5 Å terminal–Zn band")
    fig.savefig(output / "terminal_energetics_and_orientation.png", dpi=220)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8.5, 5.0), constrained_layout=True)
    elements = ("C", "H", "O", "Zn")
    x = np.arange(len(elements))
    width = 0.34
    for chemistry_index, chemistry in enumerate(("pfa", "alkane")):
        differences = []
        low_error = []
        high_error = []
        for element in elements:
            row = [
                item for item in summary_rows
                if item["chemistry"] == chemistry
                and item["metric"] == f"Terminal-framework {element} LJ energy"
            ][0]
            difference = float(row["block_mean_difference"])
            differences.append(difference)
            low_error.append(difference - float(row["block_95ci_low"]))
            high_error.append(float(row["block_95ci_high"]) - difference)
        offset = (chemistry_index - 0.5) * width
        ax.bar(
            x + offset, differences, width,
            yerr=np.array([low_error, high_error]),
            color=colors[chemistry], alpha=0.85, capsize=4,
            label=labels[chemistry],
        )
    ax.axhline(0, color="black", linewidth=0.9)
    ax.set_xticks(x, ["Framework C", "Framework H", "Framework O", "Framework Zn"])
    ax.set_ylabel("Inside − outside band LJ energy (kJ/mol)")
    ax.set_title("Which framework atoms stabilize the selected terminal–Zn geometry?")
    ax.grid(axis="y", alpha=0.25)
    ax.legend(frameon=False)
    fig.savefig(output / "terminal_energy_decomposition.png", dpi=220)
    plt.close(fig)


def write_readme(
    output: Path,
    framework: Framework,
    cutoff: float,
    band: tuple[float, float],
    overall: list[dict[str, object]],
    summary_rows: list[dict[str, object]],
) -> None:
    counts = {
        element: int(np.sum(framework.elements == element))
        for element in sorted(set(framework.elements))
    }
    lines = [
        "# C10 custom movie analysis",
        "",
        "This analysis uses every equilibrium movie frame and the symmetry-expanded",
        "IRMOF-1 CIF. Each PDB molecule is read as a consecutive 10-site block;",
        "sites 1 and 10 are the terminal CF3/CH3 sites, and sites 2--9 are the",
        "CF2/CH2 backbone.",
        "",
        f"* Framework atoms after symmetry expansion: {len(framework.coordinates)} ({counts})",
        f"* Orthorhombic box: {framework.box.tolist()} A",
        f"* LJ cutoff: {cutoff:g} A",
        f"* Selected terminal-Zn band: {band[0]:g}--{band[1]:g} A",
        "* Lorentz-Berthelot mixing; epsilon values supplied in kelvin.",
        "* The CIF charges are zero, so only framework-guest LJ energy is evaluated.",
        "* LJ tail corrections are not assigned per molecule and are omitted.",
        "* Confidence intervals use 20 consecutive 50-frame blocks.",
        "",
        "## Files",
        "",
        "* molecule_level.csv: one row per molecule per frame",
        "* terminal_level.csv: one row per terminal per frame",
        "* conditional_summary.csv: conditional means and block confidence intervals",
        "* overall_summary.csv: loading and global distribution summaries",
        "* terminal_Zn_vs_whole_chain.png: 2D conditional distributions",
        "* conditional_whole_chain_means.png: inside/outside-band comparisons",
        "* chain_profile_and_terminal_counts.png: site energy profile and terminal counts",
        "* terminal_energetics_and_orientation.png: terminal energy and angular distributions",
        "* terminal_energy_decomposition.png: conditional energy change by framework element",
        "",
        "## Interpretation rule",
        "",
        "A more negative backbone-framework LJ energy means stronger cumulative",
        "backbone stabilization. If the 4.5--5.5 A terminal-Zn observations have",
        "substantially more negative backbone energy or more engaged backbone sites",
        "than observations outside the band, that supports whole-chain templating.",
        "Little conditional difference argues that terminal radial localization is",
        "not simply a proxy for unusually strong backbone contact.",
        "",
        "## Overall summary",
        "",
    ]
    for row in overall:
        lines.extend([
            f"### {str(row['chemistry']).upper()}",
            "",
            f"* Frames: {row['n_frames']}",
            f"* Mean molecules/frame: {row['mean_molecules_per_frame']:.3f}",
            f"* Terminal observations in 4.5--5.5 A band: {100*row['terminal_band_fraction']:.2f}%",
            f"* Molecules with any terminal in band: {100*row['molecules_any_terminal_band_fraction']:.2f}%",
            f"* Molecules with both terminals in band: {100*row['molecules_both_terminals_band_fraction']:.2f}%",
            f"* Median nearest-terminal-Zn distance: {row['median_terminal_nearest_Zn_A']:.3f} A",
            f"* Median backbone-framework LJ energy: {row['median_backbone_framework_LJ_kJmol']:.3f} kJ/mol",
            f"* Median end-to-end distance: {row['median_end_to_end_A']:.3f} A",
            "",
        ])
    lines.extend(["## Conditional results", ""])
    for row in summary_rows:
        lines.append(
            f"* {str(row['chemistry']).upper()} — {row['metric']}: "
            f"inside {row['inside_mean']:.4f}, outside {row['outside_mean']:.4f}, "
            f"difference {row['difference_inside_minus_outside']:.4f} {row['unit']} "
            f"(block 95% CI {row['block_95ci_low']:.4f} to {row['block_95ci_high']:.4f})."
        )
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
    args = parser.parse_args()

    if args.output.exists():
        shutil.rmtree(args.output)
    args.output.mkdir(parents=True)
    framework = parse_raspa_cif(args.cif)
    expected_counts = {"Zn": 32, "O": 104, "C": 192, "H": 96}
    actual_counts = {
        element: int(np.sum(framework.elements == element))
        for element in expected_counts
    }
    if actual_counts != expected_counts:
        raise ValueError(
            f"Unexpected IRMOF-1 symmetry expansion: {actual_counts}; "
            f"expected {expected_counts}."
        )

    all_molecules: dict[str, list[dict[str, float]]] = {}
    all_terminals: dict[str, list[dict[str, float]]] = {}
    overall: list[dict[str, object]] = []
    summary_rows: list[dict[str, object]] = []

    for chemistry, movie in (("pfa", args.pfa_movie), ("alkane", args.alkane_movie)):
        molecule_rows, terminal_rows, metadata = analyze_movie(
            movie, framework, chemistry, args.cutoff,
            (args.band_low, args.band_high),
        )
        all_molecules[chemistry] = molecule_rows
        all_terminals[chemistry] = terminal_rows
        write_csv(args.output / f"{chemistry}_molecule_level.csv", molecule_rows)
        write_csv(args.output / f"{chemistry}_terminal_level.csv", terminal_rows)
        chemistry_summary, chemistry_overall = summarize(
            chemistry, molecule_rows, terminal_rows, metadata
        )
        summary_rows.extend(chemistry_summary)
        overall.append(chemistry_overall)

    write_csv(args.output / "conditional_summary.csv", summary_rows)
    write_csv(args.output / "overall_summary.csv", overall)
    plot_results(args.output, all_terminals, all_molecules, summary_rows)
    write_readme(
        args.output, framework, args.cutoff,
        (args.band_low, args.band_high), overall, summary_rows
    )
    shutil.copy2(Path(__file__), args.output / "custom_movie_analysis.py")
    archive = shutil.make_archive(str(args.output), "zip", root_dir=args.output)
    print(f"Wrote analysis to {args.output}")
    print(f"Wrote archive to {archive}")
    for row in overall:
        print(row)
    for row in summary_rows:
        print(row)


if __name__ == "__main__":
    main()
