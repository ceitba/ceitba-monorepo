// Must match the API's anchor algorithm exactly: NFD without combining
// marks, lowercase, runs of non-[a-z0-9] → "-", trimmed ("Cómo se
// calcula" → "como-se-calcula"). Duplicates get -2, -3 (see below).
export function headingId(text: string): string {
  return text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
