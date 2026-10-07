package org.ceitba.api.web.auth;

import org.ceitba.api.config.AuthProperties;
import org.ceitba.api.service.auth.ApiKeyScope;
import org.ceitba.api.service.auth.ApiKeyService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;

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

    private static ApiKeyService.ValidatedKey key(ApiKeyScope... scopes) {
        return new ApiKeyService.ValidatedKey(null, null, ApiKeyScope.normalize(List.of(scopes)));
    }

    @Test
    void anyKeyMayRevokeItselfButNoOtherKey() {
        var id = java.util.UUID.randomUUID();
        var self = new ApiKeyService.ValidatedKey(id, null, ApiKeyScope.normalize(List.of(ApiKeyScope.READ)));
        assertThat(ApiKeyFilter.scopeDenial(self, "DELETE", "/v1/auth/api-keys/" + id)).isNull();
        assertThat(ApiKeyFilter.scopeDenial(self, "DELETE", "/v1/auth/api-keys/" + java.util.UUID.randomUUID()))
            .isNotNull();
    }

    @Test
    void readOnlyKeysOnlyPassSafeMethodsAndReadStyleQueries() {
        var read = key(ApiKeyScope.READ);
        assertThat(ApiKeyFilter.scopeDenial(read, "GET", "/v1/me/schedules")).isNull();
        assertThat(ApiKeyFilter.scopeDenial(read, "HEAD", "/v1/articles")).isNull();
        assertThat(ApiKeyFilter.scopeDenial(read, "POST", "/v1/classrooms/conflicts")).isNull();
        for (String m : new String[] {"POST", "PUT", "PATCH", "DELETE"}) {
            assertThat(ApiKeyFilter.scopeDenial(read, m, "/v1/me/schedules")).as(m).isNotNull();
        }
        assertThat(ApiKeyFilter.scopeDenial(key(ApiKeyScope.WRITE), "POST", "/v1/me/schedules")).isNull();
    }

    @Test
    void onlyFullPowerKeysManageKeys() {
        var scoped = key(ApiKeyScope.READ, ApiKeyScope.WRITE);
        assertThat(ApiKeyFilter.scopeDenial(scoped, "POST", "/v1/auth/api-keys")).isNotNull();
        assertThat(ApiKeyFilter.scopeDenial(scoped, "DELETE", "/v1/auth/api-keys/abc")).isNotNull();
        assertThat(ApiKeyFilter.scopeDenial(scoped, "GET", "/v1/auth/api-keys")).isNull();
        var full = key();
        assertThat(ApiKeyFilter.scopeDenial(full, "POST", "/v1/auth/api-keys")).isNull();
    }
}
