# CEITBA

The platform of CEITBA, ITBA's student center: academic data from ITBA (careers, subjects, schedules), student
tools built on it (scheduler, Apuntes, subject wikis) and the student newsletter. One domain shared by the API and
the web app. Seed glossary: `/domain-modeling` and `/grill-with-docs` extend it as terms get settled.

## Academic data (mirrored from ITBA)

**SGA**:
ITBA's academic system, the upstream source of careers, plans, subjects and commissions. Reached only through
the API's ITBA client (`apps/api/src/external/itba*`); see `apps/api/docs/ITBA-GATEWAY.md`.
_Avoid_: ITBA API (when you mean the data source)

**Career**:
A degree program offered by ITBA (`careers`).
_Avoid_: Carrera (in code), degree

**Plan**:
A study plan of a Career: the set of Subjects and their requirements for one curriculum version.
_Avoid_: Curriculum

**Plan entry**:
One Subject placed in a Plan as ITBA lists it: its section, year and term, prerequisites and credits within that
Plan (`plan_entry`, with staff edits applied in `plan_entry_effective`). A Subject can have several entries in one
Plan (orientations).
_Avoid_: plan subject (the older `plan_subject` table keeps one per Subject)

**Subject**:
A course of study identified by its ITBA code (e.g. `61.12`). The unit that Apuntes, wiki pages and schedules
attach to.
_Avoid_: Materia (in code), course

**Commission**:
One section of a Subject in a term, with its own weekly time slots and classrooms.
_Avoid_: Comisión (in code), section, class

**Schedule correction**:
A student-suggested replacement for a Commission's SGA time slots; once enough students confirm it, it replaces
the SGA slots wherever the API serves them. See `apps/api/docs/SCHEDULE-CORRECTIONS.md`.

## Student tools

**Saved schedule**:
A schedule a student built in the scheduler and stored on their account; one can be marked primary.

**Share session**:
A group room in the scheduler built from one Saved schedule; others join with theirs and a public viewer merges
everyone into a heatmap.

**Apuntes**:
Student notes synced from Google Drive folders students share with the CEITBA bot, stored in MinIO and served per
Subject. See `apps/api/docs/DRIVE-SYNC.md`.
_Avoid_: Notes (ambiguous with wiki notes), Drive files (when you mean the feature)

**Drive source**:
A Drive folder registered for Apuntes: a student's folder, or a community archive and its subject folders.

**Subject wiki**:
LLM-written Markdown pages per Subject, built from published Apuntes and cross-linked. Stored as KB pages in the
`wiki` schema. See `apps/api/docs/SUBJECT-WIKI.md`.
_Avoid_: KB (in UI copy)

**KB run**:
One execution of the wiki pipeline (scheduled, manual or eval) that detects, digests, plans, writes and publishes
Subject wiki pages. See `apps/api/docs/SUBJECT-WIKI-PIPELINE.md`.

**Study group**:
A student-created group for a Subject with a type, locations and an optional participant cap.

**Proposal**:
A student proposal ("Propuesta") to CEITBA that others vote and comment on, moderated by Moderators.

## Newsletter

**Organization**:
A student organization that publishes Articles and Events in the newsletter and that users can follow.
_Avoid_: Org (in prose), club

**Article**:
A newsletter post published by an Organization or independently.

**Comment**:
A signed-in reader's plain-text reaction under a published Article; a reply answers a top-level Comment (one level
only). See `apps/api/docs/NEWSLETTER-ENGAGEMENT.md`.

**Poll**:
A single-choice question that belongs to one Article and sits in its body as a ```` ```poll ```` block. Its results
show after voting or only once it closes, as the author chooses.
_Avoid_: Survey, vote (votes are the 👍/👎 on an Article)

**Digest**:
The Monday "La semana en ITBA" email: last week's Articles, next week's Events and a personal "Tu cuatrimestre"
block. See `apps/api/docs/WEEKLY-DIGEST.md`.
_Avoid_: Newsletter (that is the app)

## Access

**Staff**:
A CEITBA member with an active `ceitba_staff` row, which grants `ROLE_STAFF` (the `/manage` and newsletter admin
areas). Distinct from a Staff member, the public roster entry on the site.

**Moderator**:
A user with the MODERATOR grant, who moderates Proposals.

**Capability**:
A per-user or per-organization feature gate (e.g. `apuntes`) used to open a feature to a few people before
everyone. See `apps/api/docs/CAPABILITIES.md`.
_Avoid_: Feature flag (that is `CONTRIBUTIONS_ENABLED`-style build-time config)

**Highlight**:
An item in the mobile app's home-screen carousel, managed by Staff.

**Benefit**:
A discount or perk for students listed on the site, managed by Staff.
