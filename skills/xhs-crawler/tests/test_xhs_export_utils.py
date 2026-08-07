import os
import sys
import unittest


SCRIPTS = os.path.join(os.path.dirname(__file__), "..", "scripts")
sys.path.insert(0, os.path.abspath(SCRIPTS))

from xhs_export_utils import canonical_note_id, deduplicate_posts


NOTE_A = "6a3ca3f70000000011006f49"
NOTE_B = "697e212200000000280212d3"
NOTE_C = "6a733858000000000502bedd"


def record(slug, filename, note):
    return {"slug": slug, "path": filename, "note": note}


class ExportDedupTests(unittest.TestCase):
    def test_canonical_note_id(self):
        self.assertEqual(
            canonical_note_id(
                f"https://www.xiaohongshu.com/explore/{NOTE_A}?xsec_token=secret"
            ),
            NOTE_A,
        )
        self.assertEqual(
            canonical_note_id("https://www.xiaohongshu.com/search_result?keyword=x"),
            "",
        )

    def test_rejects_mismatched_ids_and_deduplicates_across_topics(self):
        posts = [
            record(
                "前端",
                "a.json",
                {
                    "id": NOTE_A,
                    "url": f"https://www.xiaohongshu.com/explore/{NOTE_A}",
                    "title": "同一标题",
                    "author": "同一作者",
                    "desc": "同一正文",
                    "images": ["https://img.example/a.jpg"],
                },
            ),
            record(
                "缓存",
                "b.json",
                {
                    "id": NOTE_B,
                    "url": f"https://www.xiaohongshu.com/explore/{NOTE_A}",
                    "title": "错误地保存成另一篇",
                },
            ),
            record(
                "后端",
                "c.json",
                {
                    "id": NOTE_A,
                    "url": f"https://www.xiaohongshu.com/explore/{NOTE_A}",
                    "title": "同一标题",
                    "author": "同一作者",
                    "desc": "同一正文",
                    "images": ["https://img.example/a.jpg"],
                },
            ),
            record(
                "数据库",
                "d.json",
                {
                    "id": NOTE_C,
                    "url": f"https://www.xiaohongshu.com/explore/{NOTE_C}",
                    "title": "同一标题",
                    "author": "同一作者",
                    "desc": "同一正文",
                    "images": ["https://img.example/a.jpg"],
                },
            ),
        ]

        unique, issues = deduplicate_posts(posts)

        self.assertEqual([item["note"]["id"] for item in unique], [NOTE_A])
        self.assertEqual(
            [item["reason"] for item in issues],
            ["actual-id-mismatch", "duplicate-note-id", "duplicate-content"],
        )


if __name__ == "__main__":
    unittest.main()
