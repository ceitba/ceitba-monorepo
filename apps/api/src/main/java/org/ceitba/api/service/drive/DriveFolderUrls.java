package org.ceitba.api.service.drive;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.regex.Pattern;

// Extracts a Drive folder id from what a student pastes:
//   https://drive.google.com/drive/folders/<id>[?usp=sharing]
//   https://drive.google.com/drive/u/1/folders/<id>
//   https://drive.google.com/open?id=<id>   (any URL with ?id=<id>)
//   <id>                                    (bare id)
public final class DriveFolderUrls {

    // Drive ids are URL-safe base64-ish: letters, digits, '-' and '_'.
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{10,128}");
    private static final Pattern FOLDERS_PATH = Pattern.compile("/folders/([A-Za-z0-9_-]+)");

    private DriveFolderUrls() {}

    public static Optional<String> parse(String input) {
        if (input == null) return Optional.empty();
        var s = input.trim();
        if (s.isEmpty()) return Optional.empty();
        if (ID.matcher(s).matches()) return Optional.of(s);

        URI uri;
        try {
            uri = URI.create(s.contains("://") ? s : "https://" + s);
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        var host = uri.getHost();
        if (host == null || !(host.equals("drive.google.com") || host.equals("docs.google.com"))) {
            return Optional.empty();
        }
        if (uri.getRawPath() != null) {
            var m = FOLDERS_PATH.matcher(uri.getRawPath());
            if (m.find()) return valid(m.group(1));
        }
        if (uri.getRawQuery() != null) {
            for (var pair : uri.getRawQuery().split("&")) {
                int eq = pair.indexOf('=');
                if (eq > 0 && pair.substring(0, eq).equals("id")) {
                    return valid(URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
                }
            }
        }
        return Optional.empty();
    }

    private static Optional<String> valid(String id) {
        return ID.matcher(id).matches() ? Optional.of(id) : Optional.empty();
    }
}
