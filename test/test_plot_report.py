"""Focused static checks for the reference isotherm plot presentation."""

from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "reference_scripts" / "plot_report.py"


class PlotReportLegendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tree = ast.parse(SOURCE_PATH.read_text(encoding="utf-8"))
        cls.assignments = {
            node.targets[0].id: ast.literal_eval(node.value)
            for node in cls.tree.body
            if isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id in {
                "CHAIN_IDENTIFIER_FONTSIZE",
                "CHAIN_LEGEND_TITLE_FONTSIZE",
                "DATASET_LEGEND_FONTSIZE",
            }
        }

    def test_multi_digit_chain_label_uses_typographic_subscripts(self) -> None:
        namespace = {"re": re}
        selected_nodes = [
            node
            for node in self.tree.body
            if (isinstance(node, ast.Assign) and node.targets[0].id == "SUBSCRIPT_DIGITS")
            or (isinstance(node, ast.FunctionDef) and node.name == "format_component_label")
        ]
        exec(compile(ast.Module(body=selected_nodes, type_ignores=[]), str(SOURCE_PATH), "exec"), namespace)

        self.assertEqual("C₁₀", namespace["format_component_label"]("C10"))
        self.assertEqual("C₁₂₃", namespace["format_component_label"]("C123"))
        self.assertEqual("methane", namespace["format_component_label"]("methane"))

    def test_chain_and_dataset_legends_have_independent_font_sizes(self) -> None:
        self.assertGreaterEqual(self.assignments["CHAIN_IDENTIFIER_FONTSIZE"], 20)
        self.assertLessEqual(self.assignments["CHAIN_IDENTIFIER_FONTSIZE"], 24)
        self.assertLess(
            self.assignments["CHAIN_LEGEND_TITLE_FONTSIZE"],
            self.assignments["CHAIN_IDENTIFIER_FONTSIZE"],
        )
        self.assertNotEqual(
            self.assignments["CHAIN_IDENTIFIER_FONTSIZE"],
            self.assignments["DATASET_LEGEND_FONTSIZE"],
        )

        plot_series = next(
            node for node in self.tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "plot_series"
        )
        legend_calls = [
            node for node in ast.walk(plot_series)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "legend"
        ]
        fontsize_names = {
            keyword.value.id
            for call in legend_calls
            for keyword in call.keywords
            if keyword.arg == "fontsize" and isinstance(keyword.value, ast.Name)
        }
        self.assertEqual(
            {"CHAIN_IDENTIFIER_FONTSIZE", "DATASET_LEGEND_FONTSIZE"},
            fontsize_names,
        )
        method_calls = {
            node.func.attr
            for node in ast.walk(plot_series)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        }
        self.assertIn("get_texts", method_calls)
        self.assertIn("set_fontsize", method_calls)
        self.assertIn("set_fontweight", method_calls)
        self.assertIn("get_title", method_calls)

        constants_used = {
            node.id for node in ast.walk(plot_series) if isinstance(node, ast.Name)
        }
        self.assertIn("CHAIN_LEGEND_TITLE_FONTSIZE", constants_used)


if __name__ == "__main__":
    unittest.main()
