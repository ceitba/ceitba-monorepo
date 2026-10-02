package org.ceitba.api.web.auth;

import org.ceitba.api.config.AuthProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import static org.assertj.core.api.Assertions.assertThat;

// Static sync key handling (the ceitba_ user-key path needs the DB; see AuthIT).
class ApiKeyFilterTest {

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    private static ApiKeyFilter filter(String syncKey) {
        var props = new AuthProperties(null, null, syncKey, null, null, null, null);
        return new ApiKeyFilter(props, null, null, null);
    }

    private static void call(ApiKeyFilter f, String header) throws Exception {
        var req = new MockHttpServletRequest("POST", "/v1/sync/all");
        if (header != null) req.addHeader(ApiKeyFilter.HEADER, header);
        f.doFilter(req, new MockHttpServletResponse(), new MockFilterChain());
    }

    @Test
    void exactSyncKeyGrantsRoleSync() throws Exception {
        call(filter("s3cret"), "s3cret");
        var auth = SecurityContextHolder.getContext().getAuthentication();
        assertThat(auth).isNotNull();
        assertThat(auth.getAuthorities()).extracting(Object::toString).containsExactly("ROLE_SYNC");
    }

    @Test
    void wrongOrPartialKeyGrantsNothing() throws Exception {
        var f = filter("s3cret");
        for (String key : new String[] {"s3cre", "s3cret2", "S3CRET", ""}) {
            call(f, key);
            assertThat(SecurityContextHolder.getContext().getAuthentication()).as(key).isNull();
        }
    }

    // AUTH_SYNC_API_KEY defaults to empty: an empty header must not match it.
    @Test
    void unsetSyncKeyNeverMatches() throws Exception {
        call(filter(""), "");
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        call(filter(null), "anything");
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }
}
