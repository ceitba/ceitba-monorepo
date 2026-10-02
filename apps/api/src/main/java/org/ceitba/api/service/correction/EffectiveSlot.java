package org.ceitba.api.service.correction;

import org.ceitba.api.domain.DayOfWeek;

import java.time.LocalTime;

// A served weekly slot: SGA's, or a correction's with the room borrowed from
// the SGA slot at the same position (see CorrectionSlots.withRooms).
public record EffectiveSlot(DayOfWeek day, LocalTime from, LocalTime to, String classroom, String building) {}
