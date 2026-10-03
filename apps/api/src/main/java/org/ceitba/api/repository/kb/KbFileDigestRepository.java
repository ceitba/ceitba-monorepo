package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbFileDigest;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface KbFileDigestRepository extends JpaRepository<KbFileDigest, UUID> {

    List<KbFileDigest> findByContentFingerprintInAndPromptVersion(Collection<String> fingerprints, String promptVersion);

    boolean existsByFileIdAndContentFingerprintAndPromptVersion(UUID fileId, String fingerprint, String promptVersion);
}
