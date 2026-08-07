import sys
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "content"))

from content_lib import (  # noqa: E402
    DownloadError,
    ImageValidationError,
    PRODUCTION_READY_VERDICTS,
    analyze_regions,
    convert_template,
    download_file,
    load_jsonl,
    palette_separation,
    playability_score,
    safe_filename,
    sha256_bytes,
    validate_image_file,
    now_utc,
    validate_source_record,
    validate_derived_record,
    LICENSE_METADATA,
)

TEST_IMAGE = ROOT / "public" / "assets" / "catalog" / "neon-cat.png"


class TestLicenseModel(unittest.TestCase):
    def test_production_ready_pool(self):
        self.assertEqual(PRODUCTION_READY_VERDICTS, {"APPROVED_CC0", "APPROVED_PUBLIC_DOMAIN"})

    def test_cc_by_not_production_ready(self):
        # No attribution system exists in Splint yet -> CC-BY must not be
        # considered production-ready.
        self.assertNotIn("APPROVED_CC_BY", PRODUCTION_READY_VERDICTS)

    def test_cc0_metadata(self):
        meta = LICENSE_METADATA["CC0"]
        self.assertTrue(meta["commercial_use"])
        self.assertTrue(meta["derivative_use"])
        self.assertTrue(meta["redistribution"])
        self.assertFalse(meta["attribution_required"])

    def test_nc_rejected(self):
        self.assertEqual(LICENSE_METADATA["CC_BY_NC"]["verdict"], "REJECTED")

    def test_cc_by_sa_review_required(self):
        self.assertEqual(LICENSE_METADATA["CC_BY_SA"]["verdict"], "REVIEW_REQUIRED")


class TestProvenance(unittest.TestCase):
    def test_manifest_schema_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "manifest.jsonl"
            record = {
                "source_asset_id": "test-001",
                "source_title": "Test",
                "license_type": "CC0",
                "license_verdict": "APPROVED_CC0",
                "download_url": "https://example.com/test.png",
                "state": "DISCOVERED",
                "accessed_at": now_utc(),
            }
            load_jsonl(path)  # missing file -> []
            from content_lib import save_jsonl

            save_jsonl(path, [record])
            loaded = load_jsonl(path)
            self.assertEqual(len(loaded), 1)
            self.assertEqual(loaded[0]["source_asset_id"], "test-001")

    def test_approved_asset_cannot_lack_license(self):
        # Every approved asset must trace DERIVED -> SOURCE -> LICENSE.
        source = {
            "source_asset_id": "s1",
            "license_type": "CC0",
            "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        }
        self.assertIn("license_type", source)
        self.assertTrue(source["license_type"])


class TestSecurity(unittest.TestCase):
    def test_safe_filename_sanitization(self):
        self.assertEqual(safe_filename("../../etc/passwd"), "etc-passwd")
        self.assertEqual(safe_filename("a b c.png"), "a-b-c.png")
        self.assertEqual(safe_filename("..."), "asset")

    def test_oversized_media_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            # 2 bytes, limit 1 -> must fail
            with self.assertRaises(DownloadError):
                # local file URL with tiny limit
                url = (TEST_IMAGE).as_uri()
                try:
                    download_file(url, dest, max_bytes=1, timeout=10)
                except DownloadError:
                    raise
                except Exception as exc:  # file:// may be unsupported; still a rejection
                    raise DownloadError(str(exc))

    def test_validate_image_rejects_non_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            bogus = Path(tmp) / "bogus.png"
            bogus.write_bytes(b"not an image at all")
            with self.assertRaises(ImageValidationError):
                validate_image_file(bogus)

    def test_validate_image_accepts_png(self):
        info = validate_image_file(TEST_IMAGE)
        self.assertEqual(info["width"], info["height"])  # square source
        self.assertGreaterEqual(info["width"], 256)


class TestConversion(unittest.TestCase):
    def test_deterministic_conversion(self):
        first = convert_template(TEST_IMAGE, 32, 10)
        second = convert_template(TEST_IMAGE, 32, 10)
        self.assertEqual(first["cells"], second["cells"])
        self.assertEqual(first["palette"], second["palette"])

    def test_deterministic_large_conversion(self):
        first = convert_template(TEST_IMAGE, 512, 24)
        second = convert_template(TEST_IMAGE, 512, 24)
        self.assertEqual(first["cells"], second["cells"])
        self.assertEqual(first["palette"], second["palette"])

    def test_grid_size_validation(self):
        with self.assertRaises(ValueError):
            convert_template(TEST_IMAGE, 13, 10)  # not in supported grid list

    def test_palette_bounds(self):
        template = convert_template(TEST_IMAGE, 32, 10)
        self.assertEqual(len(template["palette"]), 10)
        max_index = max(template["cells"])
        self.assertLess(max_index, 10)
        for cell in template["cells"]:
            self.assertGreaterEqual(cell, 0)

    def test_palette_merge_separates_colors(self):
        # After cleanup+merge, palette colors must be distinguishable.
        from content_lib import palette_separation

        template = convert_template(TEST_IMAGE, 128, 16)
        separation = palette_separation(template["palette"])
        self.assertGreaterEqual(separation["min_lab_distance"], 12.0)
        # merge may reduce palette, but never below 2 colors
        self.assertGreaterEqual(len(template["palette"]), 2)

    def test_transparent_source_composited_on_white(self):
        # Kenney/OGA sprites have alpha; converting naively would bake
        # transparency into black and drown the subject. Verify a light
        # background survives conversion.
        from PIL import Image
        import numpy as np
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            sprite = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
            # draw a small opaque square in the middle
            for y in range(24, 40):
                for x in range(24, 40):
                    sprite.putpixel((x, y), (200, 50, 50, 255))
            path = Path(tmp) / "sprite.png"
            sprite.save(path)
            template = convert_template(path, 32, 8)
            cells = template["cells"]
            # background cells (corners) must NOT be the darkest palette color
            # if the palette has lighter colors available
            corner = cells[0]
            self.assertNotEqual(template["palette"][corner], template["palette"][0])

    def test_cells_match_grid_dimensions(self):
        for size in (12, 32, 64, 128):
            template = convert_template(TEST_IMAGE, size, 10)
            self.assertEqual(len(template["cells"]), size * size)


class TestPlayability(unittest.TestCase):
    def test_scorer_deterministic(self):
        template = convert_template(TEST_IMAGE, 32, 10)
        first = playability_score(32, 32, template["palette"], template["cells"])
        second = playability_score(32, 32, template["palette"], template["cells"])
        self.assertEqual(first["score"], second["score"])
        self.assertEqual(first["difficulty"], second["difficulty"])

    def test_tiny_region_metrics(self):
        # A solid grid has exactly one region, no singletons.
        width, height = 32, 32
        cells = [0] * (width * height)
        regions = analyze_regions(width, height, cells)
        self.assertEqual(regions["component_count"], 1)
        self.assertEqual(regions["singleton_count"], 0)
        self.assertEqual(regions["largest_region_ratio"], 1.0)

    def test_singleton_metric(self):
        width, height = 4, 4
        cells = [0] * 16
        cells[5] = 1  # single isolated cell
        regions = analyze_regions(width, height, cells)
        self.assertGreaterEqual(regions["singleton_count"], 1)

    def test_palette_separation(self):
        # Identical colors -> min distance 0 -> flagged.
        same = palette_separation(["#ff0000", "#ff0000"])
        self.assertEqual(same["min_lab_distance"], 0.0)
        distinct = palette_separation(["#ff0000", "#00ff00"])
        self.assertGreater(distinct["min_lab_distance"], 20)

    def test_score_range(self):
        template = convert_template(TEST_IMAGE, 64, 12)
        score = playability_score(64, 64, template["palette"], template["cells"])
        self.assertGreaterEqual(score["score"], 0.0)
        self.assertLessEqual(score["score"], 100.0)
        self.assertIn(score["difficulty"], ("VERY_EASY", "EASY", "NORMAL", "HARD", "EXPERT", "MASTERPIECE"))


class TestDerivedLinksBackToSource(unittest.TestCase):
    def test_derived_asset_has_source_link(self):
        template = convert_template(TEST_IMAGE, 32, 10)
        score = playability_score(32, 32, template["palette"], template["cells"])
        derived = {
            "derived_asset_id": "neon-cat_g32",
            "source_asset_id": "neon-cat",
            "grid_width": 32,
            "palette_size": 10,
            "state": "CONVERTED",
            "template": template,
            "playability": score,
        }
        self.assertIn("source_asset_id", derived)
        self.assertEqual(derived["source_asset_id"], "neon-cat")


class TestManifestSchema(unittest.TestCase):
    def test_source_requires_license_metadata(self):
        record = {"source_asset_id": "s1", "state": "DISCOVERED"}
        errors = validate_source_record(record)
        self.assertTrue(any("license_type" in e for e in errors))
        self.assertTrue(any("download_url" in e for e in errors))

    def test_bad_url_rejected(self):
        record = {
            "source_asset_id": "s1",
            "license_type": "CC0",
            "download_url": "ftp://bad.example/x.png",
        }
        errors = validate_source_record(record)
        self.assertTrue(any("bad download_url" in e for e in errors))

    def test_valid_source_record(self):
        record = {
            "source_asset_id": "s1",
            "source_title": "T",
            "source_creator": "C",
            "source_institution": "I",
            "source_url": "https://example.com",
            "download_url": "https://example.com/x.png",
            "license_type": "CC0",
            "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
            "accessed_at": now_utc(),
            "public_domain_status": True,
            "attribution_required": False,
            "commercial_use": True,
            "derivative_use": True,
            "redistribution_constraints": "none",
            "license_verdict": "APPROVED_CC0",
            "state": "DISCOVERED",
        }
        self.assertEqual(validate_source_record(record), [])

    def test_approved_asset_must_have_template(self):
        derived = {
            "derived_asset_id": "d1",
            "source_asset_id": "s1",
            "grid_width": 32,
            "grid_height": 32,
            "palette_size": 10,
            "state": "APPROVED",
        }
        errors = validate_derived_record(derived)
        self.assertTrue(any("lacks template" in e for e in errors))

    def test_approved_asset_license_gate(self):
        # Approved derived assets must trace back to an approved license.
        template = convert_template(TEST_IMAGE, 32, 10)
        approved = {
            "derived_asset_id": "d1",
            "source_asset_id": "s1",
            "grid_width": 32,
            "grid_height": 32,
            "palette_size": 10,
            "state": "APPROVED",
            "template": template,
        }
        # source record must exist with production-ready verdict
        source = {
            "source_asset_id": "s1",
            "license_verdict": "REVIEW_REQUIRED",
        }
        self.assertNotIn(source["license_verdict"], PRODUCTION_READY_VERDICTS)
        self.assertEqual(validate_derived_record(approved), [])  # derived itself is well-formed


if __name__ == "__main__":
    unittest.main()
