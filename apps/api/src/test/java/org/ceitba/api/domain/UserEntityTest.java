package org.ceitba.api.domain;

import org.hibernate.annotations.DynamicUpdate;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

// Guards the lost-update fix without a database: User rows are written by
// both whole-entity saves (profile/preferences) and the conditional
// single-column file_number UPDATE (UserRepository.setFileNumberIfNull), so
// a save must only write the columns it changed. MeProfileIT exercises the actual race against Postgres.
class UserEntityTest {

    @Test
    void updatesOnlyChangedColumns() {
        assertThat(User.class.isAnnotationPresent(DynamicUpdate.class)).isTrue();
    }
}
