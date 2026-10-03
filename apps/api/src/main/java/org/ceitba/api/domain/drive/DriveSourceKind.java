package org.ceitba.api.domain.drive;

// STUDENT: a student's shared folder (user_id set). COMMUNITY_ROOT: a
// community archive; its top-level folders become COMMUNITY sources (one per
// subject) and the root itself is never walked. COMMUNITY: one such folder,
// without an owning user (V42, docs/DRIVE-SYNC.md "Community sources").
public enum DriveSourceKind {
    STUDENT,
    COMMUNITY_ROOT,
    COMMUNITY
}
