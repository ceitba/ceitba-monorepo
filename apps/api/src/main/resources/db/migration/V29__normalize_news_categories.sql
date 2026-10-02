-- =============================================================================
-- V29__normalize_news_categories.sql
--
-- Articles and events now take one canonical category list (see
-- org.ceitba.api.domain.news.NewsCategories and ItbaNews
-- src/constants/categories.js), validated case-sensitively on write and
-- matched exactly by the ?category= filter. Older SPA builds stored other
-- spellings ('ACADÉMICO', 'DEPORTES', 'academico', ' Cultura ', ...).
--
-- Rule: a value whose trimmed, accent-folded, lower-cased form equals that of
-- a canonical value is rewritten to the canonical spelling. Anything else
-- (e.g. 'TODOS', 'tech') is left untouched: there is no safe guess for it.
-- analytics_events.category is folded too so category view counts merge.
--
-- Accents are folded with translate() rather than the unaccent extension
-- (not installed), and upper-case accented letters are folded before
-- lower() so the result does not depend on the database's LC_CTYPE.
-- =============================================================================

UPDATE public.articles a
SET    category = m.canonical
FROM   (VALUES ('academico',      'Académico'),
                ('campus',         'Campus'),
                ('cultura',        'Cultura'),
                ('deportes',       'Deportes'),
                ('tecnologia',     'Tecnología'),
                ('organizaciones', 'Organizaciones'),
                ('general',        'General')) AS m(folded, canonical)
WHERE  lower(translate(btrim(a.category), 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu')) = m.folded
  AND  a.category <> m.canonical;

UPDATE public.news_events e
SET    category = m.canonical
FROM   (VALUES ('academico',      'Académico'),
                ('campus',         'Campus'),
                ('cultura',        'Cultura'),
                ('deportes',       'Deportes'),
                ('tecnologia',     'Tecnología'),
                ('organizaciones', 'Organizaciones'),
                ('general',        'General')) AS m(folded, canonical)
WHERE  lower(translate(btrim(e.category), 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu')) = m.folded
  AND  e.category <> m.canonical;

UPDATE public.analytics_events ae
SET    category = m.canonical
FROM   (VALUES ('academico',      'Académico'),
                ('campus',         'Campus'),
                ('cultura',        'Cultura'),
                ('deportes',       'Deportes'),
                ('tecnologia',     'Tecnología'),
                ('organizaciones', 'Organizaciones'),
                ('general',        'General')) AS m(folded, canonical)
WHERE  lower(translate(btrim(ae.category), 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu')) = m.folded
  AND  ae.category IS NOT NULL
  AND  ae.category <> m.canonical;
