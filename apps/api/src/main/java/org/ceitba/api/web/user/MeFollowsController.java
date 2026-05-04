package org.ceitba.api.web.user;

import org.ceitba.api.domain.User;
import org.ceitba.api.service.news.FollowService;
import org.ceitba.api.web.auth.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.List;

@RestController
@RequestMapping("/v1/me/follows")
public class MeFollowsController {

    private final FollowService follows;

    public MeFollowsController(FollowService follows) {
        this.follows = follows;
    }

    @GetMapping
    public List<FollowResponse> list(@CurrentUser User user) {
        return follows.listForUser(user.getId()).stream()
            .map(f -> new FollowResponse(f.getOrganization(), f.getCreatedAt()))
            .toList();
    }

    @PostMapping("/{slug}")
    public ResponseEntity<FollowResponse> follow(@PathVariable String slug, @CurrentUser User user) {
        var f = follows.follow(user.getId(), slug);
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(new FollowResponse(f.getOrganization(), f.getCreatedAt()));
    }

    @DeleteMapping("/{slug}")
    public ResponseEntity<Void> unfollow(@PathVariable String slug, @CurrentUser User user) {
        follows.unfollow(user.getId(), slug);
        return ResponseEntity.noContent().build();
    }

    public record FollowResponse(String orgSlug, OffsetDateTime createdAt) {}
}
