package org.ceitba.api.service.mail;

import java.util.List;
import java.util.Locale;

// Coarse class of the client behind an open/click, from its User-Agent: all
// that is stored about it (never the IP or the full UA). SCANNER marks
// security scanners, link checkers and bots that fetch links/images without
// a person: their events are recorded but flagged and excluded from stats.
public enum MailClientClass {
    GMAIL_PROXY,
    YAHOO_PROXY,
    OUTLOOK,
    BROWSER,
    SCANNER,
    UNKNOWN;

    // Substrings (lower case) of known scanners / bots / non-browser clients.
    private static final List<String> SCANNERS = List.of(
        "bot", "crawler", "spider", "slurp", "scanner", "preview", "fetcher",
        "curl/", "wget/", "python", "go-http-client", "java/", "okhttp", "apache-httpclient", "libwww",
        "httpclient", "node-fetch", "axios", "headlesschrome", "phantomjs", "puppeteer", "playwright",
        "barracuda", "proofpoint", "mimecast", "symantec", "messagelabs", "trendmicro", "forcepoint",
        "fireeye", "sophos", "cisco", "ironport", "zscaler", "paloalto", "checkpoint", "kaspersky",
        "facebookexternalhit", "whatsapp", "telegram", "discord", "skypeuripreview");

    public String db() {
        return name().toLowerCase(Locale.ROOT);
    }

    public boolean isScanner() {
        return this == SCANNER;
    }

    public static MailClientClass of(String userAgent) {
        if (userAgent == null || userAgent.isBlank()) return SCANNER;
        String ua = userAgent.toLowerCase(Locale.ROOT);
        // Mail providers' image proxies fetch the pixel when a person opens
        // the email (Gmail caches it afterwards): real opens.
        if (ua.contains("googleimageproxy")) return GMAIL_PROXY;
        if (ua.contains("yahoomailproxy")) return YAHOO_PROXY;
        for (String s : SCANNERS) {
            if (ua.contains(s)) return SCANNER;
        }
        if (ua.contains("outlook") || ua.contains("microsoft office")) return OUTLOOK;
        if (ua.startsWith("mozilla/")) return BROWSER;
        return UNKNOWN;
    }
}
