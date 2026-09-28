package org.ceitba.api.web.user.dto;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

// The token cap must match user_devices.token (VARCHAR(1024), V23): a longer
// token has to be a 400, not a database error.
class RegisterDeviceRequestTest {

    private static ValidatorFactory factory;
    private static Validator validator;

    @BeforeAll
    static void setUp() {
        factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @AfterAll
    static void tearDown() {
        factory.close();
    }

    @Test
    void tokenIsCappedAt1024Characters() {
        assertThat(RegisterDeviceRequest.MAX_TOKEN_LENGTH).isEqualTo(1024);
        assertThat(validator.validate(new RegisterDeviceRequest("t".repeat(1024), "ios", null))).isEmpty();
        assertThat(validator.validate(new RegisterDeviceRequest("t".repeat(1025), "ios", null)))
            .singleElement()
            .satisfies(v -> assertThat(v.getPropertyPath().toString()).isEqualTo("token"));
    }
}
