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
