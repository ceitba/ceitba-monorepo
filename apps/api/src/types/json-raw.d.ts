// JSON.rawJSON / JSON.isRawJSON (TC39 "JSON.parse source text access"),
// implemented by Bun (JavaScriptCore) but not yet in TypeScript's lib.
interface RawJSON {
  readonly rawJSON: string;
}

interface JSON {
  rawJSON(text: string): RawJSON;
  isRawJSON(value: unknown): value is RawJSON;
}
