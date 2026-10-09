# Test-only migration mirrors

Integration tests run Flyway with `target: '4.x'` (see `src/test/resources/application.yml`)
because `V5+` in `db/migration` seed production-only data (superadmin, careers,
organizations) that breaks count assertions and FK-restricted `deleteAll()` calls.

**Mirror rule:** whenever you add a prod migration `V<N>__*.sql` that changes the
schema (DDL), add a copy of its DDL-only part here as the next `V4.<n>__*.sql` and
bump `spring.flyway.target` in `src/test/resources/application.yml` to that version.
Skip seed/`INSERT` statements. Otherwise Hibernate `ddl-auto=validate` fails at
startup in every IT that touches the new entity.

Flyway compares versions numerically per segment, so `4.10` sorts after `4.9`.

| Test mirror | Prod migration |
|---|---|
| V4.2 newsletter_org_membership | V8/V9 |
| V4.3 user_follows | V10 |
| V4.4 drop_member_count | V11 |
| V4.5 user_preferences | V13 |
| V4.6 staff_and_benefits_content | V12 |
| V4.7 saved_schedules | V14 |
| V4.8 benefit_cards | V15 |
| V4.9 share_sessions | V16 |
| V4.10 refresh_tokens | V17 |
| V4.11 user_social_handles | V18 |
| V4.12 moderators | V19 |
| V4.13 home_highlights | V20 |
| V4.14 benefits_contact_and_categories | V21 |
| V4.15 saved_schedules_primary | V22 |
| V4.16 user_devices | V23 |
| V4.17 study_groups | V24 |
| V4.18 proposals | V25 |
| V4.19 user_firebase_uid | V26 |
| V4.20 article_push_sent_at | V27 |
| V4.21 drop_user_sga_synced_at | V28 |
| V4.22 schedule_corrections | V30 |
| V4.23 drive_sync | V31 |
| V4.24 drive_file_flags | V32 |
| V4.25 subject_wiki | V33 |
| V4.26 drive_academic_year | V34 |
| V4.27 wiki_pipeline | V35 |
| V4.28 kb_progress | V36 |
| V4.29 kb_run_lease | V37 |
| V4.30 kb_batch_submission | V38 |
| V4.31 capabilities | V39 |
| V4.32 drive_kb_privacy | V40 |
| V4.33 kb_pipeline_review_fixes | V41 |
| V4.34 drive_community_sources | V42 |
| V4.35 weekly_digest | V45 |
| V4.36 saved_schedules_payload_updated_at | V46 |
| V4.37 mail_quota_tracking | V47 |
| V4.38 mail_sender_accounts | V48 |
| V4.39 kb_oom_guards | V49 |
| V4.40 kb_run_subject_skipped | V50 |
| V4.41 kb_llm_endpoint | V51 |
| V4.42 kb_model_remote_id | V52 |
| V4.43 kb_widen_model_fields | V53 |
| V4.44 org_self_service | V54 |
| V4.45 event_signup | V55 |
| V4.46 push_log | V56 |
