import json
import re

NOTE_ID_RE = re.compile(r"^[0-9a-f]{24}$", re.IGNORECASE)
EXPLORE_PATH_RE = re.compile(r"/explore/([0-9a-f]{24})(?:[/?#]|$)", re.IGNORECASE)


def _normalize(value):
    return " ".join(str(value or "").split())


def canonical_note_id(url):
    match = EXPLORE_PATH_RE.search(str(url or ""))
    return match.group(1).lower() if match else ""


def content_fingerprint(note):
    title = _normalize(note.get("title"))
    author = _normalize(note.get("author"))
    desc = _normalize(note.get("desc"))
    images = sorted(
        {_normalize(url) for url in note.get("images") or [] if _normalize(url)}
    )
    if not title or not (author or desc or images):
        return ""
    return json.dumps(
        [title, author, desc, images], ensure_ascii=False, separators=(",", ":")
    )


def validate_post(note):
    stored_id = str(note.get("id") or "").lower()
    url_id = canonical_note_id(note.get("url"))
    declared_actual_id = str(note.get("actualId") or "").lower()

    if not NOTE_ID_RE.fullmatch(stored_id):
        return False, "invalid-note-id", ""
    if not _normalize(note.get("title")):
        return False, "no-title", url_id or declared_actual_id
    if url_id and url_id != stored_id:
        return False, "actual-id-mismatch", url_id
    if declared_actual_id and declared_actual_id != stored_id:
        return False, "declared-actual-id-mismatch", declared_actual_id
    return True, "", url_id or declared_actual_id or stored_id


def deduplicate_posts(records):
    unique = []
    issues = []
    seen_ids = set()
    seen_content = set()

    for record in records:
        note = record.get("note") or {}
        valid, reason, actual_id = validate_post(note)
        if not valid:
            issues.append({**record, "reason": reason, "actual_id": actual_id})
            continue
        if actual_id in seen_ids:
            issues.append(
                {**record, "reason": "duplicate-note-id", "actual_id": actual_id}
            )
            continue
        fingerprint = content_fingerprint(note)
        if fingerprint and fingerprint in seen_content:
            issues.append(
                {**record, "reason": "duplicate-content", "actual_id": actual_id}
            )
            continue
        seen_ids.add(actual_id)
        if fingerprint:
            seen_content.add(fingerprint)
        unique.append(record)

    return unique, issues
