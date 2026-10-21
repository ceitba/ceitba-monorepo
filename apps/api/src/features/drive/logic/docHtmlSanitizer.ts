// Port of apps/api/src/main/java/org/ceitba/api/service/drive/DocHtmlSanitizer.java.
//
// Turns the HTML of a Google Doc export into something safe to inline in the
// SPA: jsoup's Safelist.relaxed (no style, class, script, iframe, event
// handlers) plus <s> and data-align (from GoogleDocsHtml; ol keeps
// start/type), images only from our asset endpoint, Google's link redirector
// unwrapped and links marked nofollow. Returns the body's inner HTML and its text.
// The implementation is the byte-identical jsoup port in ./jsoup/pipeline.ts.

export { sanitize as sanitizeDocHtml, unwrapGoogleRedirect, type SanitizedDoc } from './jsoup/pipeline';
