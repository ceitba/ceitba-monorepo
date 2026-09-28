package org.ceitba.api.service.user;

import org.ceitba.api.common.exception.ValidationException;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

// Normalizes the social handles on the profile. Each accepts a bare handle,
// an @handle or a profile URL (with or without scheme / www.) and returns the
// bare handle, lowercased. Anything that does not reduce to a valid handle is
// a ValidationException. Clients build the profile URL from the handle.
public final class SocialHandles {

    // LinkedIn custom URLs: 3-100 letters, digits or hyphens (letters may be
    // non-ASCII in auto-generated slugs).
    private static final Pattern LINKEDIN = Pattern.compile("^[\\p{L}\\p{N}-]{3,100}$");
    // Instagram usernames: 1-30 of a-z, 0-9, '.' and '_'.
    private static final Pattern INSTAGRAM = Pattern.compile("^[a-z0-9._]{1,30}$");
    // instagram.com/<first segment> paths that are not profiles (posts, reels,
    // stories, explore, IGTV, account pages).
    private static final Set<String> INSTAGRAM_RESERVED =
        Set.of("p", "reel", "reels", "stories", "explore", "tv", "accounts");
    // Discord: current usernames are 2-32 of a-z, 0-9, '.' and '_'; legacy
    // tags are "Name#1234" (2-32 chars, no '@', '#', ':' or '`'). Legacy names
    // may contain single spaces between words, but no other whitespace
    // (tabs, newlines, NBSP...), no control / format characters and no
    // leading or trailing space.
    private static final Pattern DISCORD = Pattern.compile("^[a-z0-9._]{2,32}$");
    private static final String DISCORD_LEGACY_CHAR = "[^\\p{Z}\\p{javaWhitespace}\\p{Cc}\\p{Cf}@#:`]";
    private static final Pattern DISCORD_LEGACY = Pattern.compile(
        "^(?=.{2,32}#)" + DISCORD_LEGACY_CHAR + "+(?: " + DISCORD_LEGACY_CHAR + "+)*#\\d{4}$");

    private SocialHandles() {}

    public static String linkedin(String raw) {
        String v = stripAt(raw);
        String path = urlPath(v, "linkedin.com");
        if (path != null) {
            // Only personal profiles: linkedin.com/in/<slug>[/...]
            String[] seg = path.split("/");
            if (seg.length < 2 || !"in".equalsIgnoreCase(seg[0])) {
                throw invalid("linkedin", raw, "must be a linkedin.com/in/<handle> URL or a handle");
            }
            // Browsers percent-encode non-ASCII slugs (jos%C3%A9-p%C3%A9rez).
            try {
                v = URLDecoder.decode(seg[1], StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) {
                throw invalid("linkedin", raw, "must be 3-100 letters, digits or hyphens");
            }
        }
        v = v.toLowerCase(Locale.ROOT);
        if (!LINKEDIN.matcher(v).matches()) {
            throw invalid("linkedin", raw, "must be 3-100 letters, digits or hyphens");
        }
        return v;
    }

    public static String instagram(String raw) {
        String v = stripAt(raw);
        String path = urlPath(v, "instagram.com");
        if (path != null) {
            // Only profiles: instagram.com/<handle>[/], never a post, reel,
            // story or other non-profile page.
            String[] seg = path.split("/");
            if (seg.length != 1 || INSTAGRAM_RESERVED.contains(seg[0].toLowerCase(Locale.ROOT))) {
                throw invalid("instagram", raw, "must be an instagram.com/<handle> URL or a handle");
            }
            v = seg[0];
        }
        v = v.toLowerCase(Locale.ROOT);
        if (!INSTAGRAM.matcher(v).matches()) {
            throw invalid("instagram", raw, "must be 1-30 letters, digits, '.' or '_'");
        }
        return v;
    }

    public static String discord(String raw) {
        String v = stripAt(raw);
        if (DISCORD_LEGACY.matcher(v).matches()) {
            return v;
        }
        v = v.toLowerCase(Locale.ROOT);
        if (!DISCORD.matcher(v).matches()) {
            throw invalid("discord", raw, "must be a Discord username (2-32 of a-z, 0-9, '.', '_')");
        }
        return v;
    }

    private static String stripAt(String raw) {
        String v = raw.trim();
        return v.startsWith("@") ? v.substring(1).trim() : v;
    }

    // Path (no leading slash, no query/fragment) when `v` is a URL on `domain`
    // or one of its subdomains; null when `v` is not such a URL.
    private static String urlPath(String v, String domain) {
        String rest = v.replaceFirst("(?i)^https?://", "");
        int slash = rest.indexOf('/');
        String host = (slash < 0 ? rest : rest.substring(0, slash)).toLowerCase(Locale.ROOT);
        if (!host.equals(domain) && !host.endsWith("." + domain)) {
            return null;
        }
        String path = slash < 0 ? "" : rest.substring(slash + 1);
        path = path.replaceFirst("[?#].*$", "");
        return path;
    }

    private static ValidationException invalid(String field, String value, String reason) {
        return new ValidationException(field, value, reason);
    }
}
