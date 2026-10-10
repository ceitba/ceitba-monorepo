// Whether a page holds unsaved edits. The article editor sets it; the
// router blocker reads it.
let _unsaved = false
let _bypassNext = false

export function setUnsavedChanges(value: unknown): void {
  _unsaved = Boolean(value)
}

// For the page's own navigations (e.g. to the edit URL after the first
// save): let the next one through even if edits are pending.
export function allowNextNavigation(): void {
  _bypassNext = true
}

export function shouldBlockNavigation(): boolean {
  if (_bypassNext) { _bypassNext = false; return false }
  return _unsaved
}
