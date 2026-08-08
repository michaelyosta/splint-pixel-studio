import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "content"))

from art_director import (  # noqa: E402
    background_ratio,
    conversion_quality,
    edge_preservation,
    game_quality,
    select_resolutions,
    source_quality,
    subject_bbox,
    crop_to_subject,
)
from content_lib import convert_template, load_jsonl  # noqa: E402

TEST_IMAGE = ROOT / "public" / "assets" / "catalog" / "neon-cat.png"


def find_source(manifest, sid):
    sources = load_jsonl(manifest)
    for s in sources:
        if s["source_asset_id"] == sid:
            return s
    return None


MANIFEST = ROOT / "data" / "content" / "source-manifest.jsonl"


class TestSubjectCrop(unittest.TestCase):
    def test_bbox_on_full_frame_image_is_none(self):
        # neon-cat fills its frame; no crop should be proposed.
        bbox = subject_bbox(str(TEST_IMAGE))
        self.assertIsNone(bbox)

    def test_crop_to_subject_preserves_size(self):
        from PIL import Image

        with Image.open(TEST_IMAGE) as im:
            w, h = im.size
        bbox = {"x": 100, "y": 100, "w": 200, "h": 200}
        img = Image.new("RGB", (w, h))
        out = crop_to_subject(img, bbox)
        side = max(bbox["w"], bbox["h"])
        self.assertEqual(out.size, (side, side))


class TestGates(unittest.TestCase):
    def test_source_quality_bounds(self):
        sq = source_quality(str(TEST_IMAGE))
        self.assertGreaterEqual(sq["score"], 0)
        self.assertLessEqual(sq["score"], 100)
        self.assertIn("bbox", sq)

    def test_conversion_quality_bounds(self):
        template = convert_template(str(TEST_IMAGE), 64, 12)
        cq = conversion_quality(str(TEST_IMAGE), template)
        self.assertGreaterEqual(cq["score"], 0)
        self.assertLessEqual(cq["score"], 100)
        self.assertGreaterEqual(cq["edge_preservation"], 0)
        self.assertLessEqual(cq["edge_preservation"], 1)

    def test_game_quality_bounds(self):
        template = convert_template(str(TEST_IMAGE), 64, 12)
        gq = game_quality(template, str(TEST_IMAGE))
        self.assertGreaterEqual(gq["score"], 0)
        self.assertLessEqual(gq["score"], 100)
        self.assertIn("difficulty", gq)
        self.assertIn("estimated_taps", gq)

    def test_edge_preservation_range(self):
        template = convert_template(str(TEST_IMAGE), 32, 10)
        edges = edge_preservation(str(TEST_IMAGE), template)
        self.assertGreaterEqual(edges, 0)
        self.assertLessEqual(edges, 1)

    def test_background_ratio(self):
        template = convert_template(str(TEST_IMAGE), 32, 10)
        bg = background_ratio(template)
        self.assertGreaterEqual(bg, 0)
        self.assertLessEqual(bg, 1)


class TestResolutionSelection(unittest.TestCase):
    def test_select_resolutions_returns_list(self):
        chosen = select_resolutions(str(TEST_IMAGE), "medium")
        self.assertIsInstance(chosen, list)
        self.assertLessEqual(len(chosen), 2)  # ONE or TWO, never five

    def test_resolutions_have_gate_scores(self):
        chosen = select_resolutions(str(TEST_IMAGE), "medium")
        for c in chosen:
            self.assertIn("grid", c)
            self.assertIn("gate_score", c)
            self.assertIn("template", c)
            self.assertIn("source_quality", c)
            self.assertIn("conversion_quality", c)
            self.assertIn("game_quality", c)

    def test_kenney_giraffe_not_five_sizes(self):
        # The user-flagged case: same giraffe in 5 sizes must collapse to 1-2.
        src = find_source(MANIFEST, "kenney-animal-pack-giraffe")
        if not src:
            self.skipTest("giraffe source not in manifest")
        chosen = select_resolutions(src["source_file_path"], "medium")
        self.assertLessEqual(len(chosen), 2)

    def test_blank_tile_rejected(self):
        # A single-color tile has no structure -> no passing resolution.
        src = find_source(MANIFEST, "kenney-tiny-town-tile_0000")
        if not src:
            self.skipTest("tile_0000 not in manifest")
        chosen = select_resolutions(src["source_file_path"], "small")
        self.assertEqual(chosen, [])


if __name__ == "__main__":
    unittest.main()
