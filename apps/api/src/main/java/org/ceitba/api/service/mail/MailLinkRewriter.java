package org.ceitba.api.service.mail;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.IntFunction;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Open/click tracking of an email body (docs/WEEKLY-DIGEST.md):
//   - every http(s) link of the HTML part (href="…") and of the plain-text
//     part becomes `${trackingBase}/{linkId}`; the same URL gets the same id
//     in both parts;
//   - links already known (the issue's shared links) keep their id, the
//     others are numbered from PERSONAL_BASE in order of appearance;
//   - the open pixel goes at the end of the HTML body;
//   - links the caller marks as untracked (the body unsubscribe link, which
//     must keep working even if tracking rows are missing) are left alone;
//   - in the plain-text part a URL ends before trailing sentence punctuation
//     (. , ; : ! ? and an unbalanced ")"), which stays outside the link.
// Headers (List-Unsubscribe) are never touched: only html/text are passed in.
// The original URLs are returned so the caller stores them; the redirect
// endpoint resolves a link id only from that server-side copy.
public final class MailLinkRewriter {

    // Link ids below this are the issue's shared links; from here on, the
    // per-reader links of one delivery.
    public static final int PERSONAL_BASE = 1000;

    public record Link(int id, String url, String urlKey, String label) {}

    public record Result(String html, String text, List<Link> personalLinks) {}

    private static final Pattern HREF = Pattern.compile("href=\"([^\"]*)\"", Pattern.CASE_INSENSITIVE);
    private static final Pattern ANCHOR = Pattern.compile(
        "<a\\s[^>]*?href=\"([^\"]*)\"[^>]*>(.*?)</a>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern TEXT_URL = Pattern.compile("https?://[^\\s<>\"]+", Pattern.CASE_INSENSITIVE);
    private static final Pattern TAG = Pattern.compile("<[^>]*>");
    private static final Pattern TOKEN_ID = Pattern.compile("[A-Za-z0-9_-]{16,64}");
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int MAX_LABEL = 200;

    private MailLinkRewriter() {}

    // A fresh opaque tracking id: 128 random bits, base64url (22 chars).
    // Never derived from the user id.
    public static String newTrackingId() {
        byte[] b = new byte[16];
        RANDOM.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    public static boolean isWellFormedTrackingId(String id) {
        return id != null && TOKEN_ID.matcher(id).matches();
    }

    // The distinct http(s) links of a body, in order of appearance, with the
    // anchor text of their first labelled occurrence (for the shared links of
    // an issue, collected from the shared part of the template).
    public static List<Link> collect(String html, String text) {
        return collect(html, text, url -> false);
    }

    // `untracked`: URLs that are never wrapped (so they get no link id).
    public static List<Link> collect(String html, String text, Predicate<String> untracked) {
        var labels = labels(html);
        var urls = new LinkedHashMap<String, Boolean>();
        if (html != null) {
            Matcher m = HREF.matcher(html);
            while (m.find()) {
                String url = unescape(m.group(1)).trim();
                if (isHttp(url) && !untracked.test(url)) urls.putIfAbsent(url, true);
            }
        }
        if (text != null) {
            Matcher m = TEXT_URL.matcher(text);
            while (m.find()) {
                String url = trimTrailingPunctuation(m.group());
                if (!untracked.test(url)) urls.putIfAbsent(url, true);
            }
        }
        var out = new ArrayList<Link>();
        int i = 0;
        for (String url : urls.keySet()) {
            out.add(new Link(++i, url, urlKey(url), labels.getOrDefault(url, urlKey(url))));
        }
        return out;
    }

    // Rewrites both parts. `shared`: URL -> link id of the issue's links.
    // `trackingUrl`: link id -> the redirect URL. `pixelUrl`: the open pixel
    // (null = none).
    public static Result rewrite(String html, String text, Map<String, Integer> shared,
                                 IntFunction<String> trackingUrl, String pixelUrl) {
        return rewrite(html, text, shared, trackingUrl, pixelUrl, url -> false);
    }

    // `untracked`: URLs left exactly as they are (no wrapping, no link id).
    public static Result rewrite(String html, String text, Map<String, Integer> shared,
                                 IntFunction<String> trackingUrl, String pixelUrl, Predicate<String> untracked) {
        var labels = labels(html);
        var personal = new LinkedHashMap<String, Link>();
        var ids = new java.util.HashMap<String, Integer>(shared);
        IdFor idFor = url -> ids.computeIfAbsent(url, u -> {
            int id = PERSONAL_BASE + personal.size();
            personal.put(u, new Link(id, u, urlKey(u), labels.getOrDefault(u, urlKey(u))));
            return id;
        });

        String newHtml = html;
        if (html != null) {
            Matcher m = HREF.matcher(html);
            var sb = new StringBuilder(html.length() + 512);
            while (m.find()) {
                String url = unescape(m.group(1)).trim();
                String replacement = isHttp(url) && !untracked.test(url)
                    ? "href=\"" + escape(trackingUrl.apply(idFor.apply(url))) + "\""
                    : m.group();
                m.appendReplacement(sb, Matcher.quoteReplacement(replacement));
            }
            m.appendTail(sb);
            newHtml = sb.toString();
            if (pixelUrl != null) newHtml = withPixel(newHtml, pixelUrl);
        }
        String newText = text;
        if (text != null) {
            Matcher m = TEXT_URL.matcher(text);
            var sb = new StringBuilder(text.length() + 256);
            while (m.find()) {
                String raw = m.group();
                String url = trimTrailingPunctuation(raw);
                String replacement = untracked.test(url) ? raw
                    : trackingUrl.apply(idFor.apply(url)) + raw.substring(url.length());
                m.appendReplacement(sb, Matcher.quoteReplacement(replacement));
            }
            m.appendTail(sb);
            newText = sb.toString();
        }
        return new Result(newHtml, newText, List.copyOf(personal.values()));
    }

    // A URL found in running text, without the punctuation that ends the
    // sentence: trailing . , ; : ! ? and a ")" that closes nothing inside the
    // URL ("(see https://x.org/a)" -> https://x.org/a, but a Wikipedia-style
    // https://x.org/a_(b) keeps its parenthesis).
    static String trimTrailingPunctuation(String url) {
        int end = url.length();
        while (end > 0) {
            char c = url.charAt(end - 1);
            if (".,;:!?".indexOf(c) >= 0) {
                end--;
            } else if (c == ')' && unbalancedClose(url, end)) {
                end--;
            } else {
                break;
            }
        }
        return url.substring(0, end);
    }

    private static boolean unbalancedClose(String s, int end) {
        int open = 0;
        int close = 0;
        for (int i = 0; i < end; i++) {
            if (s.charAt(i) == '(') open++;
            else if (s.charAt(i) == ')') close++;
        }
        return close > open;
    }

    // The URL without its `token` query parameter (per-reader secrets), used
    // to group clicks on "the same" link across readers and shown in stats.
    public static String urlKey(String url) {
        int q = url.indexOf('?');
        if (q < 0) return url;
        int hash = url.indexOf('#', q);
        String query = hash < 0 ? url.substring(q + 1) : url.substring(q + 1, hash);
        var kept = new ArrayList<String>();
        for (String p : query.split("&")) {
            if (p.isEmpty()) continue;
            String name = p.contains("=") ? p.substring(0, p.indexOf('=')) : p;
            if (!name.toLowerCase(Locale.ROOT).equals("token")) kept.add(p);
        }
        return url.substring(0, q) + (kept.isEmpty() ? "" : "?" + String.join("&", kept));
    }

    static String withPixel(String html, String pixelUrl) {
        String img = "<img src=\"" + escape(pixelUrl) + "\" width=\"1\" height=\"1\" alt=\"\" "
            + "style=\"display:block;width:1px;height:1px;border:0;\">";
        int at = html.toLowerCase(Locale.ROOT).lastIndexOf("</body>");
        return at < 0 ? html + img : html.substring(0, at) + img + html.substring(at);
    }

    private interface IdFor {
        int apply(String url);
    }

    private static Map<String, String> labels(String html) {
        var out = new LinkedHashMap<String, String>();
        if (html == null) return out;
        Matcher m = ANCHOR.matcher(html);
        while (m.find()) {
            String url = unescape(m.group(1)).trim();
            String label = unescape(TAG.matcher(m.group(2)).replaceAll(" "))
                .replace("→", "").replaceAll("\\s+", " ").strip();
            if (!label.isEmpty() && !out.containsKey(url)) {
                out.put(url, label.length() <= MAX_LABEL ? label : label.substring(0, MAX_LABEL));
            }
        }
        return out;
    }

    private static boolean isHttp(String url) {
        String u = url.toLowerCase(Locale.ROOT);
        return u.startsWith("https://") || u.startsWith("http://");
    }

    static String unescape(String s) {
        return s.replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&amp;", "&");
    }

    private static String escape(String s) {
        return s.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;").replace(">", "&gt;")
            .replace("'", "&#39;");
    }
}
