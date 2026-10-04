package org.ceitba.api.service.mail;

import org.ceitba.api.domain.mail.MailAccountState;
import org.ceitba.api.domain.mail.MailSendLog;
import org.ceitba.api.repository.mail.MailAccountStateRepository;
import org.ceitba.api.repository.mail.MailSendLogRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

@Component
public class JpaMailLedger implements MailLedger {

    private static final int MAX_ERROR_LENGTH = 1000;

    private final MailSendLogRepository log;
    private final MailAccountStateRepository states;

    public JpaMailLedger(MailSendLogRepository log, MailAccountStateRepository states) {
        this.log = log;
        this.states = states;
    }

    @Override
    @Transactional(readOnly = true)
    public long usedSince(String account, Instant since) {
        Number n = log.sumCountedSince(account, odt(since));
        return n == null ? 0 : n.longValue();
    }

    @Override
    @Transactional(readOnly = true)
    public List<Usage> usageSince(String account, Instant since) {
        return log.findCountedSince(account, odt(since)).stream()
            .map(l -> new Usage(l.getAttemptedAt().toInstant(), l.getRecipients()))
            .toList();
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String account, String kind, int recipients, Outcome outcome, String error, Instant at) {
        String e = error == null || error.length() <= MAX_ERROR_LENGTH ? error : error.substring(0, MAX_ERROR_LENGTH);
        log.save(new MailSendLog(account, kind, recipients, outcome.db(), e, odt(at)));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<State> state(String account) {
        return states.findById(account)
            .map(s -> new State(s.getPausedUntil() == null ? null : s.getPausedUntil().toInstant(),
                s.getPauseReason(), s.getConsecutiveFailures()));
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void saveState(String account, State state, Instant now) {
        var row = states.findById(account)
            .orElseGet(() -> new MailAccountState(account, null, null, 0, odt(now)));
        row.set(state.pausedUntil() == null ? null : odt(state.pausedUntil()), state.pauseReason(),
            state.consecutiveFailures(), odt(now));
        states.save(row);
    }

    private static OffsetDateTime odt(Instant i) {
        return i.atOffset(ZoneOffset.UTC);
    }
}
