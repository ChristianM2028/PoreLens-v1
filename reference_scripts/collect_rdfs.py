#!/usr/bin/env python3
"""Collect selected raw RASPA RDF files from Cn simulation directories.

Expected input layout (RDF output may be nested more deeply):

    ROOT/
      C1/
        1/
          simulation.input
          RDF/RadialDistributionFunctions_System_0/RDF_*.dat
        2/
          ...
      C2/
        ...

The selected files are copied without changing their contents.  The output
preserves the component, run, and path beneath each run directory and includes
a CSV manifest with the pressure read from simulation.input.

Examples:

    python3 collect_rdfs.py \
        --n-values 1 \
        --adsorbate-types CH3_sp3 CH2_sp3

    python3 collect_rdfs.py \
        --n-values 1 2 3 \
        --adsorbate-types CH3_sp3 CH2_sp3 \
        --archive

    python3 collect_rdfs.py \
        --n-values 1-4 7 9-10 \
        --adsorbate-types CH3_sp3 CH2_sp3 CF2 CF3 \
        --output selected_rdfs

Comma-separated forms such as ``--n-values 1,3-5,8`` are also accepted.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import math
import re
import shutil
import sys
import tarfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


COMPONENT_RE = re.compile(r"^C(?P<n>\d+)$", re.IGNORECASE)
RUN_RE = re.compile(r"^(?P<index>\d+)(?:_|$)")
PRESSURE_RE = re.compile(
    r"^\s*ExternalPressure\s+"
    r"(?P<value>[+\-]?(?:\d+(?:\.\d*)?|\.\d+)"
    r"(?:[Ee][+\-]?\d+)?)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class SelectedFile:
    n_value: int
    component: str
    run: str
    pressure_pa: float | None
    source: Path
    source_relative: Path
    destination: Path
    destination_relative: Path


def parse_n_values(tokens: Sequence[str]) -> list[int]:
    """Expand values/ranges such as 1, ``1 2 3``, C1, or ``1-4``."""

    values: set[int] = set()

    for token_group in tokens:
        for raw_token in token_group.split(","):
            token = raw_token.strip()

            if not token:
                continue

            token = re.sub(r"^[Cc]", "", token)
            range_match = re.fullmatch(r"(\d+)\s*-\s*(\d+)", token)

            if range_match:
                start = int(range_match.group(1))
                stop = int(range_match.group(2))

                if start < 1 or stop < 1:
                    raise ValueError("n-values must be positive integers")

                if start > stop:
                    raise ValueError(
                        f"Descending n-value range is not allowed: {raw_token}"
                    )

                values.update(range(start, stop + 1))
                continue

            if not re.fullmatch(r"\d+", token):
                raise ValueError(f"Invalid n-value or range: {raw_token}")

            value = int(token)

            if value < 1:
                raise ValueError("n-values must be positive integers")

            values.add(value)

    if not values:
        raise ValueError("No n-values were supplied")

    return sorted(values)


def read_external_pressure(simulation_input: Path) -> float | None:
    """Return the first active ExternalPressure value, assumed to be Pa."""

    if not simulation_input.is_file():
        return None

    for raw_line in simulation_input.read_text(errors="replace").splitlines():
        stripped = raw_line.lstrip()

        if stripped.startswith(("#", "!", "//")):
            continue

        match = PRESSURE_RE.match(raw_line)

        if match:
            value = float(match.group("value"))
            return value if math.isfinite(value) else None

    return None


def has_raspa_rdf_data(path: Path) -> bool:
    """Check for at least two numeric RASPA RDF rows with 3+ columns."""

    valid_rows = 0

    try:
        lines = path.read_text(errors="replace").splitlines()
    except OSError:
        return False

    for raw_line in lines:
        line = raw_line.strip()

        if not line or line.startswith(("#", "!", "@", "%")):
            continue

        fields = line.replace(",", " ").split()

        if len(fields) < 3:
            continue

        try:
            values = [float(value) for value in fields[:3]]
        except ValueError:
            continue

        if not all(math.isfinite(value) for value in values):
            continue

        valid_rows += 1

        if valid_rows >= 2:
            return True

    return False


def contains_adsorbate_type(path: Path, adsorbate_types: Sequence[str]) -> bool:
    filename = path.name.casefold()
    return any(atom_type.casefold() in filename for atom_type in adsorbate_types)


def looks_like_rdf_file(path: Path, adsorbate_types: Sequence[str]) -> bool:
    if not path.is_file() or "rdf" not in path.name.casefold():
        return False

    if path.suffix.casefold() in {".png", ".jpg", ".jpeg", ".pdf", ".svg"}:
        return False

    return contains_adsorbate_type(path, adsorbate_types) and has_raspa_rdf_data(path)


def find_rdf_files(
    run_dir: Path,
    rdf_dir_name: str,
    adsorbate_types: Sequence[str],
) -> list[Path]:
    """Find matching RDF files, preferring directories named RDF."""

    rdf_dirs = [
        path
        for path in run_dir.rglob("*")
        if path.is_dir() and path.name.casefold() == rdf_dir_name.casefold()
    ]
    search_roots = rdf_dirs if rdf_dirs else [run_dir]
    candidates: set[Path] = set()

    for search_root in search_roots:
        for path in search_root.rglob("*"):
            if looks_like_rdf_file(path, adsorbate_types):
                candidates.add(path)

    return sorted(candidates, key=lambda path: str(path))


def iter_run_dirs(component_dir: Path) -> Iterable[Path]:
    """Yield direct children named 1, 2, 1_label, 2_label, etc."""

    run_dirs = [
        path
        for path in component_dir.iterdir()
        if path.is_dir() and RUN_RE.match(path.name)
    ]

    return sorted(
        run_dirs,
        key=lambda path: (int(RUN_RE.match(path.name).group("index")), path.name),
    )


def sha256sum(path: Path) -> str:
    digest = hashlib.sha256()

    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)

    return digest.hexdigest()


def discover_files(
    root: Path,
    output: Path,
    n_values: Sequence[int],
    rdf_dir_name: str,
    adsorbate_types: Sequence[str],
) -> tuple[list[SelectedFile], list[str]]:
    selected: list[SelectedFile] = []
    warnings: list[str] = []

    for n_value in n_values:
        component = f"C{n_value}"
        component_dir = root / component

        if not component_dir.is_dir():
            warnings.append(f"Missing component directory: {component_dir}")
            continue

        run_dirs = list(iter_run_dirs(component_dir))

        if not run_dirs:
            warnings.append(f"No run directories found under {component_dir}")
            continue

        for run_dir in run_dirs:
            simulation_input = run_dir / "simulation.input"
            pressure_pa = read_external_pressure(simulation_input)

            if pressure_pa is None:
                warnings.append(
                    f"No active ExternalPressure found in {simulation_input}"
                )

            rdf_files = find_rdf_files(run_dir, rdf_dir_name, adsorbate_types)

            if not rdf_files:
                warnings.append(f"No matching RDF files found under {run_dir}")
                continue

            for source in rdf_files:
                source_relative = source.relative_to(root)
                beneath_run = source.relative_to(run_dir)
                destination_relative = Path(component) / run_dir.name / beneath_run
                destination = output / destination_relative
                selected.append(
                    SelectedFile(
                        n_value=n_value,
                        component=component,
                        run=run_dir.name,
                        pressure_pa=pressure_pa,
                        source=source,
                        source_relative=source_relative,
                        destination=destination,
                        destination_relative=destination_relative,
                    )
                )

    return selected, warnings


def write_manifest(output: Path, selected: Sequence[SelectedFile]) -> Path:
    manifest = output / "manifest.csv"
    manifest.parent.mkdir(parents=True, exist_ok=True)

    with manifest.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=(
                "n_value",
                "component",
                "run",
                "pressure_pa",
                "pressure_bar",
                "rdf_filename",
                "source_relative_path",
                "collected_relative_path",
                "size_bytes",
                "sha256",
            ),
        )
        writer.writeheader()

        for item in selected:
            pressure_pa = "" if item.pressure_pa is None else f"{item.pressure_pa:.16g}"
            pressure_bar = (
                "" if item.pressure_pa is None else f"{item.pressure_pa / 1e5:.16g}"
            )
            writer.writerow(
                {
                    "n_value": item.n_value,
                    "component": item.component,
                    "run": item.run,
                    "pressure_pa": pressure_pa,
                    "pressure_bar": pressure_bar,
                    "rdf_filename": item.source.name,
                    "source_relative_path": item.source_relative.as_posix(),
                    "collected_relative_path": item.destination_relative.as_posix(),
                    "size_bytes": item.destination.stat().st_size,
                    "sha256": sha256sum(item.destination),
                }
            )

    return manifest


def copy_selected_files(
    root: Path,
    output: Path,
    selected: Sequence[SelectedFile],
    overwrite: bool,
) -> int:
    copied = 0
    copied_simulation_inputs: set[tuple[str, str]] = set()

    if output.exists() and any(output.iterdir()) and not overwrite:
        raise FileExistsError(
            f"Output directory is not empty: {output}. "
            "Use --overwrite or choose another --output directory."
        )

    for item in selected:
        item.destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item.source, item.destination)
        copied += 1

        run_key = (item.component, item.run)

        if run_key not in copied_simulation_inputs:
            source_input = root / item.component / item.run / "simulation.input"

            if source_input.is_file():
                destination_input = output / item.component / item.run / "simulation.input"
                destination_input.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_input, destination_input)

            copied_simulation_inputs.add(run_key)

    return copied


def create_archive(output: Path, overwrite: bool) -> Path:
    archive = output.with_name(f"{output.name}.tar.gz")

    if archive.exists() and not overwrite:
        raise FileExistsError(
            f"Archive already exists: {archive}. Use --overwrite to replace it."
        )

    with tarfile.open(archive, "w:gz") as handle:
        handle.add(output, arcname=output.name)

    return archive


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Collect unmodified RASPA RDF files involving selected adsorbate "
            "pseudoatom types from chosen Cn directories and all their pressures."
        )
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="Root containing C1, C2, etc. (default: current directory).",
    )
    parser.add_argument(
        "--n-values",
        nargs="+",
        required=True,
        metavar="N_OR_RANGE",
        help="Chain lengths: 1, '1 2 3', '1-4', or mixed/comma-separated forms.",
    )
    parser.add_argument(
        "--adsorbate-types",
        nargs="+",
        required=True,
        metavar="TYPE",
        help="Pseudoatom names that must occur in an RDF filename.",
    )
    parser.add_argument(
        "--rdf-dir-name",
        default="RDF",
        help="Expected RDF directory name (default: RDF).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("RDF_collection"),
        help="Collection directory (default: ROOT/RDF_collection).",
    )
    parser.add_argument(
        "--archive",
        action="store_true",
        help="Also create OUTPUT.tar.gz for convenient transfer.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace files already present at the selected output paths.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List matching files without copying anything.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_arguments()
    root = args.root.expanduser().resolve()

    if not root.is_dir():
        print(f"ERROR: Root directory does not exist: {root}", file=sys.stderr)
        return 2

    try:
        n_values = parse_n_values(args.n_values)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    output = args.output.expanduser()

    if not output.is_absolute():
        output = root / output

    output = output.resolve()

    try:
        output.relative_to(root)
    except ValueError:
        pass
    else:
        if COMPONENT_RE.fullmatch(output.name):
            print("ERROR: Output cannot be a Cn component directory.", file=sys.stderr)
            return 2

    selected, warnings = discover_files(
        root=root,
        output=output,
        n_values=n_values,
        rdf_dir_name=args.rdf_dir_name,
        adsorbate_types=args.adsorbate_types,
    )

    print(f"n-values: {', '.join(str(value) for value in n_values)}")
    print(f"Adsorbate types: {', '.join(args.adsorbate_types)}")
    print(f"Matching RDF files: {len(selected)}")

    for warning in warnings:
        print(f"WARNING: {warning}", file=sys.stderr)

    if not selected:
        print("ERROR: No matching RDF files were found.", file=sys.stderr)
        return 1

    if args.dry_run:
        for item in selected:
            pressure = "unknown pressure"

            if item.pressure_pa is not None:
                pressure = f"{item.pressure_pa:.8g} Pa ({item.pressure_pa / 1e5:.8g} bar)"

            print(f"[MATCH] {item.source_relative} [{pressure}]")

        return 0

    try:
        copied = copy_selected_files(
            root=root,
            output=output,
            selected=selected,
            overwrite=args.overwrite,
        )
        manifest = write_manifest(output, selected)
        archive = create_archive(output, args.overwrite) if args.archive else None
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(f"Copied {copied} raw RDF file(s) to {output}")
    print(f"Manifest: {manifest}")

    if archive is not None:
        print(f"Archive: {archive}")

    if warnings:
        print(f"Completed with {len(warnings)} warning(s).")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
