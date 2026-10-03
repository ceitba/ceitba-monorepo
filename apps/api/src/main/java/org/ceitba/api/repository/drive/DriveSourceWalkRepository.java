package org.ceitba.api.repository.drive;

import org.ceitba.api.domain.drive.DriveSourceWalk;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface DriveSourceWalkRepository extends JpaRepository<DriveSourceWalk, UUID> {
}
