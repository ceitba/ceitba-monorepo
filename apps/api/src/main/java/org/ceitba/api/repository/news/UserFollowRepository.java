package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.UserFollow;
import org.ceitba.api.domain.news.UserFollowId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface UserFollowRepository extends JpaRepository<UserFollow, UserFollowId> {

    List<UserFollow> findByUserId(UUID userId);

    boolean existsByUserIdAndOrganization(UUID userId, String organization);

    long countByOrganization(String organization);

    void deleteByUserIdAndOrganization(UUID userId, String organization);
}
