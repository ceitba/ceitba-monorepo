package org.ceitba.api.service.push;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

// In-memory PushGateway for tests: records every call and answers SENT unless
// a token was given another outcome, or the next call is told to fail.
public class FakePushGateway implements PushGateway {

    public record Call(List<String> tokens, PushMessage message) {}

    private final List<Call> calls = Collections.synchronizedList(new ArrayList<>());
    private final Map<String, Outcome> outcomes = new ConcurrentHashMap<>();
    private final Set<Integer> failingCalls = ConcurrentHashMap.newKeySet();

    @Override
    public List<Outcome> send(List<String> tokens, PushMessage message) {
        int index;
        synchronized (calls) {
            index = calls.size();
            calls.add(new Call(List.copyOf(tokens), message));
        }
        if (failingCalls.contains(index)) {
            throw new PushDeliveryException("simulated failure", null);
        }
        return tokens.stream().map(t -> outcomes.getOrDefault(t, Outcome.SENT)).toList();
    }

    public FakePushGateway answer(String token, Outcome outcome) {
        outcomes.put(token, outcome);
        return this;
    }

    public FakePushGateway failCall(int zeroBasedIndex) {
        failingCalls.add(zeroBasedIndex);
        return this;
    }

    public List<Call> calls() {
        synchronized (calls) {
            return List.copyOf(calls);
        }
    }

    public List<String> allTokens() {
        return calls().stream().flatMap(c -> c.tokens().stream()).toList();
    }

    public void reset() {
        calls.clear();
        outcomes.clear();
        failingCalls.clear();
    }
}
