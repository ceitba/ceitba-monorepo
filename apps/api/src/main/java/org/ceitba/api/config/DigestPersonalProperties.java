package org.ceitba.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

// "Tu cuatrimestre", the per-reader block of the weekly digest
// (docs/WEEKLY-DIGEST.md).
//   wikiBaseUrl:     CeitbaPage's Apuntes reader; a subject's wiki is
//                    <wikiBaseUrl>/<subjectId>?vista=wiki
//   schedulerUrl:    the "Armá tu horario" call to action
//   voteTokenTtl:    lifetime of the correction vote links
//   maxWikiLinks / maxCorrections: caps that keep the email short
@ConfigurationProperties(prefix = "digest.personal")
public record DigestPersonalProperties(
    String wikiBaseUrl,
    String schedulerUrl,
    Duration voteTokenTtl,
    Integer maxWikiLinks,
    Integer maxCorrections
) {

    public DigestPersonalProperties {
        wikiBaseUrl = blank(wikiBaseUrl) ? "https://ceitba.org.ar/apuntes" : wikiBaseUrl.trim().replaceAll("/+$", "");
        schedulerUrl = blank(schedulerUrl) ? "https://ceitba.org.ar/scheduler/" : schedulerUrl.trim();
        if (voteTokenTtl == null || voteTokenTtl.isZero() || voteTokenTtl.isNegative()) voteTokenTtl = Duration.ofDays(14);
        if (maxWikiLinks == null || maxWikiLinks < 0) maxWikiLinks = 5;
        if (maxCorrections == null || maxCorrections < 0) maxCorrections = 3;
    }

    public static DigestPersonalProperties defaults() {
        return new DigestPersonalProperties(null, null, null, null, null);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
