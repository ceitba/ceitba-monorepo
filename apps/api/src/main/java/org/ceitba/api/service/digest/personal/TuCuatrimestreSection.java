package org.ceitba.api.service.digest.personal;

import org.ceitba.api.config.DigestPersonalProperties;
import org.ceitba.api.config.DigestProperties;
import org.ceitba.api.service.digest.DigestComposer;
import org.ceitba.api.service.digest.DigestCorrectionVoteTokens;
import org.ceitba.api.service.digest.DigestPersonalSection;
import org.springframework.stereotype.Component;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

// The digest's per-reader block, "Tu cuatrimestre" (docs/WEEKLY-DIGEST.md):
// the reader's subjects of the current term (from their primary saved
// schedule), links to those subjects' wikis, and up to three pending
// schedule corrections on their commissions to confirm or reject from the
// email (ItbaNews /correction page, signed per-reader links).
@Component
public class TuCuatrimestreSection implements DigestPersonalSection {

    private final PersonalDigestLoader loader;
    private final DigestCorrectionVoteTokens tokens;
    private final DigestProperties digestProps;
    private final DigestPersonalProperties props;

    public TuCuatrimestreSection(PersonalDigestLoader loader, DigestCorrectionVoteTokens tokens,
                                 DigestProperties digestProps, DigestPersonalProperties props) {
        this.loader = loader;
        this.tokens = tokens;
        this.digestProps = digestProps;
        this.props = props;
    }

    @Override
    public Map<UUID, Section> forReaders(Collection<UUID> readerIds, DigestComposer.Issue issue) {
        var out = new LinkedHashMap<UUID, Section>();
        loader.load(readerIds, issue.week()).forEach((userId, p) -> out.put(userId,
            PersonalDigestRenderer.render(p, props.schedulerUrl(), correctionId -> {
                String base = digestProps.publicBaseUrl() + "/correction?token="
                    + URLEncoder.encode(tokens.issue(userId, correctionId), StandardCharsets.UTF_8);
                return new PersonalDigestRenderer.VoteLinks(base + "&vote=confirm", base + "&vote=reject");
            })));
        return out;
    }
}
