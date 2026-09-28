package org.ceitba.api.service.push;

import org.ceitba.api.repository.UserDeviceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;

// Resolves recipients to device tokens (user_devices), sends them through the
// PushGateway in batches of PushGateway.MAX_TOKENS_PER_CALL, and deletes the
// tokens FCM reports as dead.
//
// Pruning: UNREGISTERED tokens are always deleted. INVALID_ARGUMENT means
// either a malformed token or a malformed message; when every token of a
// multi-token batch fails with it, the message is the likely culprit, so
// nothing is pruned and the batch is logged as an error instead of wiping
// valid registrations. A single-token batch carries no such signal, so its
// INVALID_ARGUMENT token is pruned like any other (otherwise a user whose only
// device holds a bad token would keep it forever).
//
// A batch that fails as a whole (PushDeliveryException) is logged and skipped;
// the remaining batches are still attempted. There are no retries.
public class FcmPushNotificationService implements PushNotificationService {

    private static final Logger log = LoggerFactory.getLogger(FcmPushNotificationService.class);

    private final PushGateway gateway;
    private final UserDeviceRepository devices;

    public FcmPushNotificationService(PushGateway gateway, UserDeviceRepository devices) {
        this.gateway = gateway;
        this.devices = devices;
    }

    @Override
    public PushResult sendToUsers(Collection<UUID> userIds, PushMessage message) {
        if (userIds == null || userIds.isEmpty()) return PushResult.NONE;
        return deliver(devices.findTokensByUserIds(new LinkedHashSet<>(userIds)), message);
    }

    @Override
    public PushResult sendToOrgFollowers(String orgSlug, PushMessage message) {
        if (orgSlug == null || orgSlug.isBlank()) return PushResult.NONE;
        return deliver(devices.findTokensOfOrgFollowers(orgSlug), message);
    }

    @Override
    public PushResult broadcast(PushMessage message) {
        return deliver(devices.findAllTokens(), message);
    }

    PushResult deliver(Collection<String> tokenList, PushMessage message) {
        var tokens = List.copyOf(new LinkedHashSet<>(tokenList));
        if (tokens.isEmpty()) return PushResult.NONE;

        int sent = 0;
        var dead = new ArrayList<String>();
        for (int from = 0; from < tokens.size(); from += PushGateway.MAX_TOKENS_PER_CALL) {
            var batch = tokens.subList(from, Math.min(from + PushGateway.MAX_TOKENS_PER_CALL, tokens.size()));
            List<PushGateway.Outcome> outcomes;
            try {
                outcomes = gateway.send(batch, message);
            } catch (PushDeliveryException e) {
                log.warn("Push batch of {} tokens failed: {}", batch.size(), e.getMessage());
                continue;
            }
            if (outcomes.size() != batch.size()) {
                log.error("Push gateway returned {} outcomes for {} tokens; not pruning", outcomes.size(), batch.size());
                sent += (int) outcomes.stream().filter(o -> o == PushGateway.Outcome.SENT).count();
                continue;
            }
            boolean messageRejected = batch.size() > 1
                && outcomes.stream().allMatch(o -> o == PushGateway.Outcome.INVALID_ARGUMENT);
            if (messageRejected) {
                log.error("FCM rejected every token of a {}-token batch with INVALID_ARGUMENT; "
                    + "assuming a malformed message ({}), not pruning", batch.size(), message.data());
                continue;
            }
            for (int i = 0; i < batch.size(); i++) {
                switch (outcomes.get(i)) {
                    case SENT -> sent++;
                    case UNREGISTERED, INVALID_ARGUMENT -> dead.add(batch.get(i));
                    case FAILED -> { }
                }
            }
        }

        int pruned = 0;
        if (!dead.isEmpty()) {
            pruned = devices.deleteByTokens(dead);
            log.info("Pruned {} dead push tokens", pruned);
        }
        log.debug("Push '{}': {} targeted, {} sent, {} pruned", message.title(), tokens.size(), sent, pruned);
        return new PushResult(tokens.size(), sent, pruned);
    }
}
