package org.ceitba.api.web.auth;

import org.ceitba.api.domain.User;
import org.ceitba.api.service.auth.UserProvisioningService;
import org.springframework.core.MethodParameter;
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
        if (!(auth instanceof JwtAuthenticationToken jwtAuth)) {
            return null;
        }
        Jwt jwt = jwtAuth.getToken();
        String email = jwt.getClaimAsString("email");
        String name = jwt.getClaimAsString("name");
        if (email == null) {
            return null;
        }
        return provisioning.findOrCreate(email, name);
    }
}
