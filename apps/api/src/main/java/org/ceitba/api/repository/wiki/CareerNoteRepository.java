package org.ceitba.api.repository.wiki;

import org.ceitba.api.domain.wiki.CareerNote;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface CareerNoteRepository extends JpaRepository<CareerNote, UUID> {

    List<CareerNote> findByCareerId(String careerId);
}
