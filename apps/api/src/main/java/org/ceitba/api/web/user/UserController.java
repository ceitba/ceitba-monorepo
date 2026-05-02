package org.ceitba.api.web.user;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.service.user.UserService;
import org.ceitba.api.web.user.dto.CreateUserRequest;
import org.ceitba.api.web.user.dto.UserResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// All endpoints require ROLE_STAFF. Self-service signup is NOT supported —
// User rows are JIT-provisioned by CurrentUserResolver on the first
// authenticated request that asks for @CurrentUser. POST /create exists for
// staff to pre-create users with academic metadata (file_number, career_id,
// plan) before the user has logged in. The list endpoint exposes email +
// file_number across the user base, so it stays staff-only too.
@Tag(name = "Users")
@RestController
@RequestMapping("/v1/users")
@SecurityRequirement(name = "bearerAuth")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping("/create")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('STAFF')")
    @Operation(summary = "Create a user with academic metadata (STAFF only)")
    public UserResponse createUser(@Valid @RequestBody CreateUserRequest request) {
        return userService.create(request);
    }

    @GetMapping
    @PreAuthorize("hasRole('STAFF')")
    @Operation(summary = "List all users (STAFF only)")
    public List<UserResponse> getAllUsers() {
        return userService.getAll();
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasRole('STAFF')")
    @Operation(summary = "Get a user by ID (STAFF only)")
    public UserResponse getUserById(@PathVariable UUID id) {
        return userService.getById(id);
    }
}
