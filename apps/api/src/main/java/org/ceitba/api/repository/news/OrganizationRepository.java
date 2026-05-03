package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.Organization;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrganizationRepository extends JpaRepository<Organization, String> {}
