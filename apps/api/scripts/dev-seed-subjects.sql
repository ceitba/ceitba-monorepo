-- LOCAL DEV ONLY: common first/second-year ITBA subjects so Apuntes subject
-- matching and the subject pickers have something to work with on an empty
-- database (the real catalog comes from the ITBA sync). Codes and credits are
-- plausible, not authoritative. Idempotent.
--
--   docker compose -f docker-compose.drive.yml exec -T postgres \
--     psql -U postgres -d ceitba_db < scripts/dev-seed-subjects.sql
INSERT INTO public.subject (id, name, credits, updated_at) VALUES
    ('93.26', 'Análisis Matemático I', 6, now()),
    ('93.27', 'Análisis Matemático II', 6, now()),
    ('93.28', 'Análisis Matemático III', 6, now()),
    ('93.58', 'Álgebra Lineal', 6, now()),
    ('93.59', 'Matemática I', 6, now()),
    ('93.60', 'Matemática II', 6, now()),
    ('93.61', 'Matemática Discreta', 6, now()),
    ('93.24', 'Probabilidad y Estadística', 6, now()),
    ('93.75', 'Métodos Numéricos', 6, now()),
    ('93.41', 'Física I', 6, now()),
    ('93.42', 'Física II', 6, now()),
    ('93.43', 'Física III', 6, now()),
    ('93.44', 'Física IV', 6, now()),
    ('93.04', 'Química', 6, now()),
    ('93.05', 'Química Orgánica', 6, now()),
    ('94.21', 'Comunicación', 3, now()),
    ('94.22', 'Metodología de la Investigación', 3, now()),
    ('94.23', 'Introducción a la Ingeniería', 3, now()),
    ('94.24', 'Economía para Ingenieros', 3, now()),
    ('94.25', 'Ética y Responsabilidad Social', 3, now()),
    ('94.26', 'Inglés Técnico', 3, now()),
    ('31.08', 'Sistemas de Representación', 3, now()),
    ('72.31', 'Programación Imperativa', 6, now()),
    ('72.33', 'Programación Orientada a Objetos', 6, now()),
    ('72.34', 'Estructuras de Datos y Algoritmos', 6, now()),
    ('72.35', 'Diseño y Procesamiento de Documentos XML', 3, now()),
    ('72.37', 'Base de Datos I', 6, now()),
    ('72.38', 'Arquitectura de Computadoras', 6, now()),
    ('72.11', 'Sistemas Operativos', 6, now()),
    ('72.39', 'Autómatas, Teoría de Lenguajes y Compiladores', 6, now()),
    ('22.01', 'Estática y Resistencia de Materiales', 6, now()),
    ('22.02', 'Termodinámica', 6, now())
ON CONFLICT (id) DO NOTHING;
