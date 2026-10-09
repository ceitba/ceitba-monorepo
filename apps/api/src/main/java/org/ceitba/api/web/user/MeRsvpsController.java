package org.ceitba.api.web.user;

import org.ceitba.api.domain.User;
import org.ceitba.api.service.news.EventRsvpService;
import org.ceitba.api.web.auth.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

// The events the current user RSVP'd to, so the SPA can show "Vas a ir".
@RestController
@RequestMapping("/v1/me/rsvps")
public class MeRsvpsController {

    private final EventRsvpService rsvps;

    public MeRsvpsController(EventRsvpService rsvps) {
        this.rsvps = rsvps;
    }

    @GetMapping
    public MyRsvpsResponse list(@CurrentUser User user) {
        return new MyRsvpsResponse(rsvps.eventIdsOf(user.getId()));
    }

    public record MyRsvpsResponse(List<String> eventIds) {}
}
