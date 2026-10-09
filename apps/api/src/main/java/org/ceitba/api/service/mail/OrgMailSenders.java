package org.ceitba.api.service.mail;

import jakarta.mail.internet.InternetAddress;
import org.ceitba.api.config.EmailProperties;
import org.ceitba.api.config.OrgMailProperties;

import java.io.UnsupportedEncodingException;
import java.time.Clock;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.function.Predicate;

// The sending side of organizations' connected Gmail accounts
// (docs/ORGANIZATIONS.md): one MailSendService per account, built lazily and
// kept, so each org has its own sending-quota ledger (mail_send_log keyed by
// the account), lock and limit (org-mail.daily-limit unless
// mail.daily-limits names the address). The From header carries the org's
// name. The transport follows MAIL_ENABLED / MAIL_TRANSPORT like the CEITBA
// sender (MailConfig.orgTransport); with SMTP orgs can't send.
public class OrgMailSenders {

    private record Entry(String from, MailSendService service) {}

    private final Function<String, EmailSender> transportFor;
    private final MailLedger ledger;
    private final EmailProperties props;
    private final OrgMailProperties orgMail;
    private final Clock clock;
    private final Predicate<String> allowedRecipient;
    private final ConcurrentHashMap<String, Entry> byAccount = new ConcurrentHashMap<>();

    // transportFor: From header -> transport for that account.
    public OrgMailSenders(Function<String, EmailSender> transportFor, MailLedger ledger, EmailProperties props,
                          OrgMailProperties orgMail, Clock clock, Predicate<String> allowedRecipient) {
        this.transportFor = transportFor;
        this.ledger = ledger;
        this.props = props;
        this.orgMail = orgMail;
        this.clock = clock;
        this.allowedRecipient = allowedRecipient;
    }

    // The sender for `address`, shown as `displayName`. A new display name
    // (the org was renamed) replaces the cached sender for later sends.
    public MailSendService forAccount(String address, String displayName) {
        String account = address.trim().toLowerCase(Locale.ROOT);
        String from = fromHeader(account, displayName);
        return byAccount.compute(account, (k, e) -> e != null && e.from().equals(from) ? e
            : new Entry(from, new MailSendService(transportFor.apply(from), ledger, account, limitFor(account),
                props.backoffInitial(), props.backoffMax(), props.quotaPause(), clock, allowedRecipient)))
            .service();
    }

    int limitFor(String account) {
        return props.dailyLimits().getOrDefault(account, orgMail.dailyLimit());
    }

    static String fromHeader(String address, String displayName) {
        if (displayName == null || displayName.isBlank()) return address;
        try {
            return new InternetAddress(address, displayName.trim(), "UTF-8").toString();
        } catch (UnsupportedEncodingException e) {
            return address;
        }
    }
}
