package org.ceitba.api.repository.digest;

import org.ceitba.api.domain.digest.DigestDeliveryLink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface DigestDeliveryLinkRepository extends JpaRepository<DigestDeliveryLink, DigestDeliveryLink.Key> {

    // Before (re)writing a delivery's links (a retried send re-renders them).
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Transactional
    @Query("DELETE FROM DigestDeliveryLink l WHERE l.trackingId = :trackingId")
    int deleteByTrackingId(@Param("trackingId") String trackingId);
}
