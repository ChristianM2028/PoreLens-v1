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

    molecule_name = f"C{length}_pfa"

    def_path = adsorbate_dir / f"{molecule_name}.def"

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


def get_pressure_range() -> tuple[int, np.ndarray]:
    """
    Ask user where to start numbering and what pressure range to generate.
    Pressures are assumed to be in Pa.
    """

    start_index = input("\nstart from what point number? ").strip()
    if not start_index.isdigit():
        raise ValueError("Start index must be an integer like 31.")

    start_index = int(start_index)

    p_min = float(input("minimum pressure in Pa? ").strip())
    p_max = float(input("maximum pressure in Pa? ").strip())

    n_points = input("how many pressure points? ").strip()
    if not n_points.isdigit():
        raise ValueError("Number of pressure points must be an integer.")

    n_points = int(n_points)

    if p_min <= 0 or p_max <= 0:
        raise ValueError("Pressures must be positive for logspace.")

    if p_max <= p_min:
        raise ValueError("Maximum pressure must be greater than minimum pressure.")

    if n_points < 1:
        raise ValueError("Number of pressure points must be at least 1.")

    pressure_values = np.logspace(
        np.log10(p_min),
        np.log10(p_max),
        n_points
    )

    return start_index, pressure_values


def modify_simulation_input(
    template_path: Path,
    output_path: Path,
    pressure: float,
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

        if stripped.startswith("ExternalPressure"):
            line = f"ExternalPressure   {pressure}\n"

        elif "MoleculeName" in line and "placeholder" in line:
            line = line.replace("placeholder", molecule_name)

        modified_lines.append(line)

    with open(output_path, "w") as file:
        file.writelines(modified_lines)


def main():
    start_index, pressure_values = get_pressure_range()

    script_dir = Path(__file__).resolve().parent
    print("Current Directory:", script_dir)

    common_inputs_dir = script_dir.parent.parent / "common_inputs"

    if not common_inputs_dir.is_dir():
        raise FileNotFoundError(f"Could not find common_inputs at: {common_inputs_dir}")

    sim_template = common_inputs_dir / "simulation.input"

    if not sim_template.exists():
        raise FileNotFoundError(f"Could not find simulation.input at: {sim_template}")

    molecule_name, molecule_def_path = choose_adsorbate()

    print(f"\nSelected molecule: {molecule_name}")
    print(f"Using definition file: {molecule_def_path}")

    main_dir = script_dir

    for offset, pressure in enumerate(pressure_values):
        point_number = start_index + offset
        p_dir = main_dir / str(point_number)
        p_dir.mkdir(exist_ok=True)

        for file in common_inputs_dir.iterdir():
            if file.is_file() and file.suffix in [".def", ".job", ".cif"]:
                shutil.copy(file, p_dir)

        shutil.copy(molecule_def_path, p_dir / molecule_def_path.name)

        sim_output = p_dir / "simulation.input"

        modify_simulation_input(
            template_path=sim_template,
            output_path=sim_output,
            pressure=pressure,
            molecule_name=molecule_name
        )

        print(f"Created/updated point {point_number}: P = {pressure:.6g} Pa")

    print("\nDone. Created pressure directories with modified simulation.input files.")


if __name__ == "__main__":
    main()
