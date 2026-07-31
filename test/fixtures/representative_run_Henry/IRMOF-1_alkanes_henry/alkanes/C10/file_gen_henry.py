#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import numpy as np
import shutil
from pathlib import Path


ADSORBATE_ROOT = Path("/projects/p32177/Christian/adsorbates")


def choose_adsorbate() -> tuple[str, Path]:
    """
    Ask user for adsorbate type and molecular length.
    Returns molecule name and path to matching .def file.
    """

    if not ADSORBATE_ROOT.exists():
        raise FileNotFoundError(f"Adsorbate root does not exist: {ADSORBATE_ROOT}")

    adsorbate_dirs = sorted(
        [p for p in ADSORBATE_ROOT.iterdir() if p.is_dir()],
        key=lambda p: p.name.lower()
    )

    print("\nAvailable adsorbate types:")
    for p in adsorbate_dirs:
        print(f"  {p.name}")

    adsorbate_type = input("\nwhat adsorbate type? ").strip()
    adsorbate_dir = ADSORBATE_ROOT / adsorbate_type

    if not adsorbate_dir.is_dir():
        raise ValueError(f"Invalid adsorbate type: {adsorbate_type}")

    length = input("what length? ").strip()

    if not length.isdigit():
        raise ValueError("Length must be an integer like 1, 2, 3, etc.")

    molecule_name = f"C{length}"

    # First try the expected direct path
    def_path = adsorbate_dir / f"{molecule_name}.def"

    # If not there, search recursively inside that adsorbate directory
    if not def_path.exists():
        matches = list(adsorbate_dir.rglob(f"{molecule_name}.def"))

        if len(matches) == 1:
            def_path = matches[0]
        elif len(matches) > 1:
            print("\nMultiple matching .def files found:")
            for m in matches:
                print(f"  {m}")
            raise ValueError(f"Ambiguous molecule definition for {molecule_name}.")
        else:
            raise FileNotFoundError(
                f"Could not find {molecule_name}.def inside {adsorbate_dir}"
            )

    return molecule_name, def_path


def modify_simulation_input(
    template_path: Path,
    output_path: Path,
    molecule_name: str
) -> None:
    """
    Reads template simulation.input, replaces ExternalPressure and placeholder molecule name,
    then writes modified simulation.input to output_path.
    """

    with open(template_path, "r") as file:
        lines = file.readlines()

    modified_lines = []

    for line in lines:
        stripped = line.strip()

        if "MoleculeName" in line and "placeholder" in line:
            line = line.replace("placeholder", molecule_name)

        modified_lines.append(line)

    with open(output_path, "w") as file:
        file.writelines(modified_lines)


def main():
    # Current script directory
    script_dir = Path(__file__).resolve().parent
    print("Current Directory:", script_dir)

    # Two layers up, then common_inputs
    common_inputs_dir = script_dir.parent.parent / "common_inputs"

    if not common_inputs_dir.is_dir():
        raise FileNotFoundError(f"Could not find common_inputs at: {common_inputs_dir}")

    sim_template = common_inputs_dir / "simulation.input"

    if not sim_template.exists():
        raise FileNotFoundError(f"Could not find simulation.input at: {sim_template}")

    molecule_name, molecule_def_path = choose_adsorbate()

    print(f"\nSelected molecule: {molecule_name}")
    print(f"Using definition file: {molecule_def_path}")

    # Main output directory is the script directory
    main_dir = script_dir

    # Copy all shared common input files
    for file in common_inputs_dir.iterdir():
        if file.is_file() and file.suffix in [".def", ".job", ".cif"]:
            shutil.copy(file, Path.cwd())

            # Copy selected molecule .def into pressure directory
            shutil.copy(molecule_def_path, molecule_def_path.name)

            # Write modified simulation.input
            sim_output = "simulation.input"

        modify_simulation_input(
            template_path=sim_template,
            output_path=sim_output,
            molecule_name=molecule_name
        )

    print("\nDone. Created Henry directory with modified simulation.input files.")


if __name__ == "__main__":
    main()
