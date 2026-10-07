// Whether a page holds unsaved edits. The article editor sets it; the
// router blocker and code that leaves without a link (sign-out) read it.
let _unsaved = false
let _bypassNext = false

export function setUnsavedChanges(value) {
  _unsaved = Boolean(value)
}

export function hasUnsavedChanges() {
  return _unsaved
}

// For the page's own navigations (e.g. to the edit URL after the first
// save): let the next one through even if edits are pending.
export function allowNextNavigation() {
  _bypassNext = true
}

export function shouldBlockNavigation() {
  if (_bypassNext) { _bypassNext = false; return false }
  return _unsaved
}
