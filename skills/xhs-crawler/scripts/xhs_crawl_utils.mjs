const NOTE_ID_RE = /^[0-9a-f]{24}$/i
const EXPLORE_PATH_RE = /\/explore\/([0-9a-f]{24})(?:[/?#]|$)/i

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function canonicalNoteId(url) {
  const match = String(url || '').match(EXPLORE_PATH_RE)
  return match ? match[1].toLowerCase() : ''
}

export function noteFingerprint(note) {
  const value = note || {}
  return JSON.stringify([
    canonicalNoteId(value.url),
    normalizeText(value.title),
    normalizeText(value.author),
    normalizeText(value.desc),
    Array.isArray(value.engageNums) ? value.engageNums.map(String) : [],
  ])
}

export function contentFingerprint(note) {
  const value = note || {}
  const title = normalizeText(value.title)
  const author = normalizeText(value.author)
  const desc = normalizeText(value.desc)
  const images = Array.isArray(value.images)
    ? [...new Set(value.images.map(normalizeText).filter(Boolean))].sort()
    : []

  // A title alone is too weak: unrelated notes can legitimately share it.
  if (!title || (!author && !desc && images.length === 0)) return ''
  return JSON.stringify([title, author, desc, images])
}

export function validateCapture({ expectedId, before, current, detailVisible }) {
  const expected = String(expectedId || '').toLowerCase()
  const value = current || {}
  const title = normalizeText(value.title)
  const actualId = canonicalNoteId(value.url)

  if (!NOTE_ID_RE.test(expected)) return { ok: false, reason: 'invalid-expected-id' }
  if (!title) return { ok: false, reason: 'no-title' }
  if (actualId && actualId !== expected) {
    return { ok: false, reason: 'actual-id-mismatch', actualId }
  }
  if (!detailVisible && !actualId) {
    return { ok: false, reason: 'detail-not-open' }
  }
  if (noteFingerprint(before) === noteFingerprint(value)) {
    return { ok: false, reason: 'stale-detail' }
  }
  return { ok: true, actualId: actualId || expected }
}

export function validateStoredNote(filenameId, note) {
  const expected = String(filenameId || '').toLowerCase()
  const value = note || {}
  const storedId = String(value.id || '').toLowerCase()
  const urlId = canonicalNoteId(value.url)
  const declaredActualId = String(value.actualId || '').toLowerCase()

  if (!NOTE_ID_RE.test(expected)) return { ok: false, reason: 'invalid-filename-id' }
  if (storedId !== expected) return { ok: false, reason: 'stored-id-mismatch' }
  if (!normalizeText(value.title)) return { ok: false, reason: 'no-title' }
  if (urlId && urlId !== expected) {
    return { ok: false, reason: 'actual-id-mismatch', actualId: urlId }
  }
  if (declaredActualId && declaredActualId !== expected) {
    return {
      ok: false,
      reason: 'declared-actual-id-mismatch',
      actualId: declaredActualId,
    }
  }
  return { ok: true, actualId: urlId || declaredActualId || expected }
}

export function auditStoredNotes(records) {
  const validIds = []
  const invalid = []
  const duplicates = []
  const actualIds = new Set()
  const contentFingerprints = new Set()

  for (const record of records || []) {
    const filenameId = String(record.filenameId || '').toLowerCase()
    const checked = validateStoredNote(filenameId, record.note)
    if (!checked.ok) {
      invalid.push({ filenameId, ...checked })
      continue
    }
    if (actualIds.has(checked.actualId)) {
      duplicates.push({ filenameId, reason: 'duplicate-note-id', actualId: checked.actualId })
      continue
    }
    const fingerprint = contentFingerprint(record.note)
    if (fingerprint && contentFingerprints.has(fingerprint)) {
      duplicates.push({ filenameId, reason: 'duplicate-content', actualId: checked.actualId })
      continue
    }
    actualIds.add(checked.actualId)
    if (fingerprint) contentFingerprints.add(fingerprint)
    validIds.push(filenameId)
  }

  return { validIds, invalid, duplicates, actualIds, contentFingerprints }
}
