-- Insert real ITBA careers
INSERT INTO "careers" (id, name, updated_at) VALUES
('BIO', 'Bioingeniería', NOW()),
('C', 'Ingeniería Civil', NOW()),
('career-123', 'Computer Engineering', NOW()),
('E', 'Ingeniería Electricista', NOW()),
('I', 'Ingeniería Industrial', NOW()),
('K', 'Ingeniería Electrónica', NOW()),
('L', 'Lic.en Administración y Sistemas', NOW()),
('LAES', 'Licenciatura en Analítica Empresarial y Social', NOW()),
('LCC', 'Licenciatura en Ciencias del Comportamiento', NOW()),
('LN', 'Licenciatura en Negocios', NOW()),
('M', 'Ingeniería Mecánica', NOW()),
('N', 'Ingeniería Naval', NOW()),
('P', 'Ingeniería en Petróleo', NOW()),
('PAI', 'Proceso de Admisión', NOW()),
('Q', 'Ingeniería Química', NOW()),
('S', 'Ingeniería en Informática', NOW()),
('X', 'Intercambio', NOW())
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    updated_at = NOW();

-- Insert real ITBA plans
INSERT INTO "plan" (id, career_id, name, updated_at) VALUES
-- BIO plans
('Bio-13', 'BIO', 'Bio-13', NOW()),
('BIO 22', 'BIO', 'BIO 22', NOW()),
-- C plans
('C23', 'C', 'C23', NOW()),
-- E plans
('E 11', 'E', 'E 11', NOW()),
('E 11A', 'E', 'E 11A', NOW()),
-- I plans
('I-13', 'I', 'I-13', NOW()),
('I-13T', 'I', 'I-13T', NOW()),
('I22', 'I', 'I22', NOW()),
-- K plans
('K07A-Rev.18', 'K', 'K07A-Rev.18', NOW()),
('K07-Rev.18', 'K', 'K07-Rev.18', NOW()),
('K22', 'K', 'K22', NOW()),
-- L plans
('L09', 'L', 'L09', NOW()),
('L09-REV13', 'L', 'L09-REV13', NOW()),
('L09T', 'L', 'L09T', NOW()),
-- LAES plans
('A17', 'LAES', 'A17', NOW()),
('A22', 'LAES', 'A22', NOW()),
-- LN plans
('L20', 'LN', 'L20', NOW()),
-- M plans
('M09 - Rev18 (Agosto)', 'M', 'M09 - Rev18 (Agosto)', NOW()),
('M09 - Rev18 (Marzo)', 'M', 'M09 - Rev18 (Marzo)', NOW()),
('M22', 'M', 'M22', NOW()),
-- N plans
('N18 Agosto', 'N', 'N18 Agosto', NOW()),
('N18 Marzo', 'N', 'N18 Marzo', NOW()),
('N22', 'N', 'N22', NOW()),
-- P plans
('P05', 'P', 'P05', NOW()),
('P05-Rev.18', 'P', 'P05-Rev.18', NOW()),
('P-13', 'P', 'P-13', NOW()),
('P22', 'P', 'P22', NOW()),
-- PAI plans
('PA25 Proceso I', 'PAI', 'PA25 Proceso I', NOW()),
-- Q plans
('Q05 - Rev.18', 'Q', 'Q05 - Rev.18', NOW()),
('Q22', 'Q', 'Q22', NOW()),
-- S plans
('S10 A - Rev18', 'S', 'S10 A - Rev18', NOW()),
('S10 - Rev18', 'S', 'S10 - Rev18', NOW()),
('S10-Rev23', 'S', 'S10-Rev23', NOW()),
-- X plans
('IN23', 'X', 'IN23', NOW())
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    updated_at = NOW();
