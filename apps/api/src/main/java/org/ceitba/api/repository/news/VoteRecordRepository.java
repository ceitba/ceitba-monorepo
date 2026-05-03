package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.VoteRecord;
import org.ceitba.api.domain.news.VoteRecordId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface VoteRecordRepository extends JpaRepository<VoteRecord, VoteRecordId> {}
