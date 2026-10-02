package org.ceitba.api.repository.drive;

import org.ceitba.api.domain.drive.DriveUnclaimedShare;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface DriveUnclaimedShareRepository extends JpaRepository<DriveUnclaimedShare, String> {

    List<DriveUnclaimedShare> findAllByOrderByLastSeenAtDesc();

    @Modifying
    @Query("delete from DriveUnclaimedShare u where u.driveId in :ids")
    int deleteByDriveIdIn(@Param("ids") Collection<String> ids);
}
