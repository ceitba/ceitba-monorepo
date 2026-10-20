// KbCopyDetectorTest.words(from, n), shared with KbValidatorTest.
export function words(from: number, n: number): string {
  return Array.from({ length: n }, (_, i) => 'palabra' + (from + i)).join(' ');
}
