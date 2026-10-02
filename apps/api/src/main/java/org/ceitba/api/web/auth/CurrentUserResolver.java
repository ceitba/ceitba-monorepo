package org.ceitba.api.web.auth;

import org.ceitba.api.domain.User;
import org.ceitba.api.service.auth.InvalidTokenException;
import org.ceitba.api.service.auth.UserProvisioningService;
import org.springframework.core.MethodParameter;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

@Component
public class CurrentUserResolver implements HandlerMethodArgumentResolver {

    private final UserProvisioningService provisioning;

    public CurrentUserResolver(UserProvisioningService provisioning) {
        this.provisioning = provisioning;
    }

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(CurrentUser.class)
            && User.class.equals(parameter.getParameterType());
    }

    @Override
    public Object resolveArgument(MethodParameter parameter,
                                   ModelAndViewContainer mav,
                                   NativeWebRequest req,
                                   WebDataBinderFactory bf) {
        var auth = SecurityContextHolder.getContext().getAuthentication();

        if (auth instanceof JwtAuthenticationToken jwtAuth) {
            Jwt jwt = jwtAuth.getToken();
            String email = jwt.getClaimAsString("email");
            String name  = jwt.getClaimAsString("name");
            if (email == null) throw new InvalidTokenException("Token carries no email");
            return provisioning.findOrCreate(email, name, null, null);
        }

        // User API key auth: ApiKeyFilter places the User entity as the principal.
        if (auth != null && auth.getPrincipal() instanceof User user) {
            return user;
        }

        // Anonymous: null, for public endpoints that take an optional user
        // (e.g. GET /v1/wiki/bookmarks/{id}); protected routes never get here.
        if (auth == null || !auth.isAuthenticated() || auth instanceof AnonymousAuthenticationToken) {
            return null;
        }

        // Authenticated without a user behind it (the SYNC key): endpoints
        // that act as a user are off limits. Returning null here used to
        // surface as a NullPointerException (500) in the controller.
        // AccessDeniedException is mapped to 403 by GlobalExceptionHandler.
        throw new AccessDeniedException("This endpoint requires a user session");
    }
}
