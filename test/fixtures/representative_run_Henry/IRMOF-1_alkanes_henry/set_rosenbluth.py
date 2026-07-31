#!/usr/bin/env python3
from pathlib import Path
import re

# Edit this table.
# Example:
# "C2": 0.123,
# "C3": 0.456,
ROSENBLUTH_WEIGHTS = {
    "C2": 1.0,
    "C3": 1.0,
    "C4": 0.1296930,
    "C5": 0.0197439,
    "C6": 0.0029442,
    "C7": 0.0004450,
    "C8": 0.0000669,
    "C9": 0,
    "C10": 0,
}

MAKE_BACKUPS = True

pattern = re.compile(
    r"^([ \t]*IdealGasRosenbluthWeight[ \t]+)(\S+)(.*)$",
    flags=re.MULTILINE,
)

for molecule, weight in ROSENBLUTH_WEIGHTS.items():
    mol_dir = Path(molecule)

    if not mol_dir.is_dir():
        print(f"skipped {molecule}: directory not found")
        continue

    for isobar_dir in sorted(mol_dir.iterdir()):
        if not isobar_dir.is_dir():
            continue

        # only use isobar dirs named like 1, 2, 3, ...
        if not isobar_dir.name.isdigit():
            continue

        sim_input = isobar_dir / "simulation.input"

        if not sim_input.is_file():
            print(f"skipped {sim_input}: not found")
            continue

        old_text = sim_input.read_text()

        if "IdealGasRosenbluthWeight" not in old_text:
            print(f"skipped {sim_input}: no IdealGasRosenbluthWeight line")
            continue

        new_text, nsubs = pattern.subn(
            rf"\g<1>{weight}\g<3>",
            old_text,
            count=1,
        )

        if nsubs == 0:
            print(f"skipped {sim_input}: line format not matched")
            continue

        if new_text != old_text:
            if MAKE_BACKUPS:
                backup = sim_input.with_suffix(sim_input.suffix + ".bak")
                backup.write_text(old_text)

            sim_input.write_text(new_text)
            print(f"updated {sim_input}: IdealGasRosenbluthWeight {weight}")
        else:
            print(f"unchanged {sim_input}")
