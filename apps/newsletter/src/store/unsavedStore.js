// Whether a page holds unsaved edits, for code outside that page that can
// end the session or leave it without a link click (e.g. sign-out).
let _unsaved = false

export function setUnsavedChanges(value) {
  _unsaved = Boolean(value)
}

export function hasUnsavedChanges() {
  return _unsaved
}
