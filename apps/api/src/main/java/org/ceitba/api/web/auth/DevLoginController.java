package org.ceitba.api.web.auth;

import io.swagger.v3.oas.annotations.Hidden;
import jakarta.validation.Valid;
import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.service.auth.DevLoginService;
import org.ceitba.api.web.auth.dto.DevLoginRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

// LOCAL DEVELOPMENT ONLY (see DevLoginService). Sets the same HttpOnly
// session cookie as the Google callback. Absent (404) unless the `dev`
// profile is active and AUTH_DEV_LOGIN_ENABLED=true; SecurityConfig permits
// the path only under the same condition.
@Hidden
@RestController
@Profile("dev")
@ConditionalOnProperty(name = "auth.dev-login.enabled", havingValue = "true")
public class DevLoginController {

    public static final String PATH = "/v1/auth/dev-login";

    private final DevLoginService devLogin;
    private final AuthProperties auth;

    public DevLoginController(DevLoginService devLogin, AuthProperties auth) {
        this.devLogin = devLogin;
        this.auth = auth;
    }

    @PostMapping(PATH)
    public ResponseEntity<Void> login(@Valid @RequestBody DevLoginRequest req) {
        var token = devLogin.login(req.email(), req.name(), req.staff());
        return ResponseEntity.noContent()
            .header(HttpHeaders.SET_COOKIE, SessionCookies.issue(auth, token).toString())
            .build();
    }
}
