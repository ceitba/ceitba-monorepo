// Guards for URLs that come from API data (staff photos/LinkedIn, benefit
// images/CTAs, avatars). React does not block `javascript:` / `data:` hrefs,
// so anything rendered into href/src must pass through here first.
// Returns the normalized URL when safe, otherwise null (render no link/image).

export function safeHttpUrl(raw: string | null | undefined): string | null {
  return safeUrl(raw, ['http:', 'https:'])
}

// For links where an email address is a legitimate target (e.g. a benefit CTA).
export function safeLinkUrl(raw: string | null | undefined): string | null {
  return safeUrl(raw, ['http:', 'https:', 'mailto:'])
}

function safeUrl(raw: string | null | undefined, protocols: string[]): string | null {
  const value = raw?.trim()
  if (!value) return null
  let url: URL
  try {
    // No base: relative or scheme-less values are rejected.
    url = new URL(value)
  } catch {
    return null
  }
  return protocols.includes(url.protocol) ? url.href : null
}
