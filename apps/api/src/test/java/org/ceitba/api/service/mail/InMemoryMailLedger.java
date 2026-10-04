package org.ceitba.api.service.mail;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

// MailLedger for unit tests: same semantics as JpaMailLedger.
public class InMemoryMailLedger implements MailLedger {

    public record Row(String account, String kind, int recipients, Outcome outcome, String error, Instant at) {}

    public final List<Row> rows = new ArrayList<>();
    public final Map<String, State> states = new HashMap<>();

    private static boolean counted(Row r) {
        return r.outcome() == Outcome.SENT || r.outcome() == Outcome.REJECTED;
    }

    @Override
    public long usedSince(String account, Instant since) {
        return rows.stream().filter(r -> r.account().equals(account) && r.at().isAfter(since) && counted(r))
            .mapToLong(Row::recipients).sum();
    }

    @Override
    public List<Usage> usageSince(String account, Instant since) {
        return rows.stream().filter(r -> r.account().equals(account) && r.at().isAfter(since) && counted(r))
            .sorted(Comparator.comparing(Row::at))
            .map(r -> new Usage(r.at(), r.recipients()))
            .toList();
    }

    @Override
    public void record(String account, String kind, int recipients, Outcome outcome, String error, Instant at) {
        rows.add(new Row(account, kind, recipients, outcome, error, at));
    }

    @Override
    public Optional<State> state(String account) {
        return Optional.ofNullable(states.get(account));
    }

    @Override
    public void saveState(String account, State state, Instant now) {
        states.put(account, state);
    }

    // `n` counted sends at `at` (seeding the window).
    public void sent(String account, Instant at, int n) {
        for (int i = 0; i < n; i++) record(account, "digest", 1, Outcome.SENT, null, at);
    }
}
