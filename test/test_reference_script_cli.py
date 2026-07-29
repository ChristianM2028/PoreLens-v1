"""Fixture-backed tests for concise reference-script CLI reporting."""

from __future__ import annotations

import contextlib
import importlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "reference_scripts"
FIXTURE = ROOT / "test" / "fixtures" / "reference-script-cli-records.json"
sys.path.insert(0, str(SCRIPTS))


class ReferenceScriptCliOutputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if importlib.util.find_spec("numpy") is None:
            raise unittest.SkipTest("reference-script CLI tests require numpy")
        import numpy as np

        cls.np = np
        cls.records = json.loads(FIXTURE.read_text(encoding="utf-8"))
        cls.custom = importlib.import_module("custom_movie_analysis")
        cls.pocket = importlib.import_module("c10_pocket_decomposition")

    def run_custom(self, verbose: bool) -> str:
        framework = self.custom.Framework(
            box=self.np.ones(3),
            coordinates=self.np.zeros((424, 3)),
            elements=self.np.array(["Zn"] * 32 + ["O"] * 104 + ["C"] * 192 + ["H"] * 96),
            labels=self.np.array(["Zn1"] * 424),
        )
        overall = self.records["overall"][0]
        conditional = self.records["conditional"]
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "custom-output"
            argv = ["custom_movie_analysis.py", "--pfa-movie", "pfa.pdb",
                    "--alkane-movie", "alkane.pdb", "--cif", "framework.cif",
                    "--output", str(output)]
            if verbose:
                argv.append("--verbose")
            with mock.patch.object(sys, "argv", argv), \
                    mock.patch.object(self.custom, "parse_raspa_cif", return_value=framework), \
                    mock.patch.object(self.custom, "analyze_movie", return_value=([{"row": 1}], [{"row": 1}], {})), \
                    mock.patch.object(self.custom, "summarize", return_value=(conditional, overall)), \
                    mock.patch.object(self.custom, "plot_results"), \
                    mock.patch.object(self.custom, "write_readme"), \
                    contextlib.redirect_stdout(io.StringIO()) as stdout:
                self.custom.main()
            return stdout.getvalue()

    def run_pocket(self, verbose: bool) -> str:
        labels = self.np.concatenate([self.np.repeat(label, count) for label, count in {
            "C1": 48, "C2": 48, "C3": 96, "H1": 96, "O1": 8, "O2": 96, "Zn1": 32
        }.items()])
        framework = self.custom.Framework(self.np.ones(3), self.np.zeros((len(labels), 3)),
                                          self.np.repeat("C", len(labels)), labels)
        result = {"selected_local": self.np.empty((0, 5))}
        integrated = self.records["integrated"]
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "pocket-output"
            argv = ["c10_pocket_decomposition.py", "--pfa-movie", "pfa.pdb",
                    "--alkane-movie", "alkane.pdb", "--cif", "framework.cif",
                    "--output", str(output)]
            if verbose:
                argv.append("--verbose")
            patches = (
                mock.patch.object(self.pocket, "parse_raspa_cif", return_value=framework),
                mock.patch.object(self.pocket, "bonded_neighbors", return_value={}),
                mock.patch.object(self.pocket, "analyze_chemistry", return_value=result),
                mock.patch.object(self.pocket, "radial_rows", return_value=[]),
                mock.patch.object(self.pocket, "integrated_rows", side_effect=[integrated, []]),
                mock.patch.object(self.pocket, "window_rows", return_value=[]),
                mock.patch.object(self.pocket, "plot_integrated"),
                mock.patch.object(self.pocket, "plot_radial"),
                mock.patch.object(self.pocket, "plot_local_geometry"),
                mock.patch.object(self.pocket, "write_readme"),
            )
            with contextlib.ExitStack() as stack:
                for patch in patches:
                    stack.enter_context(patch)
                stack.enter_context(mock.patch.object(sys, "argv", argv))
                stdout = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                self.pocket.main()
            return stdout.getvalue()

    def test_custom_default_is_concise_and_verbose_prints_records(self) -> None:
        concise = self.run_custom(False)
        verbose = self.run_custom(True)
        self.assertEqual(4, len(concise.splitlines()))
        self.assertIn("1 overall records", concise)
        self.assertIn("1 conditional records", concise)
        self.assertNotIn("DETAIL_RECORD", concise)
        self.assertIn("OVERALL_DETAIL_RECORD", verbose)
        self.assertIn("CONDITIONAL_DETAIL_RECORD", verbose)

    def test_pocket_default_is_concise_and_verbose_prints_records(self) -> None:
        concise = self.run_pocket(False)
        verbose = self.run_pocket(True)
        self.assertEqual(3, len(concise.splitlines()))
        self.assertIn("1 integrated rows", concise)
        self.assertNotIn("delta_N=", concise)
        self.assertIn("pfa O2 delta_N=0.125000", verbose)


if __name__ == "__main__":
    unittest.main()
