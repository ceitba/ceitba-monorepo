-- =============================================================================
-- V7__seed_organizations.sql
--
-- Seeds the catalogue of student organisations exposed via /v1/organizations
-- and selectable from the newsletter admin/contributor forms in the SPA.
--
-- Idempotent: ON CONFLICT DO NOTHING preserves any edits made later through
-- the API. To force-refresh descriptive fields, change to DO UPDATE.
-- =============================================================================

INSERT INTO public.organizations
    (slug, name, full_name, description, category, color, member_count, founded_year)
VALUES
    ('ceitba',
     'CEITBA',
     'Centro de Estudiantes del ITBA',
     'Centro de estudiantes del ITBA. Representa a los alumnos, organiza eventos y gestiona los espacios y servicios de la comunidad estudiantil.',
     'General', 'blue', 0, NULL),

    ('sabf',
     'SABF',
     'South American Business Forum',
     'Foro internacional organizado por estudiantes del ITBA que reúne a líderes y jóvenes de todo el mundo para debatir problemáticas globales.',
     'Business', 'amber', 0, NULL),

    ('trama',
     'TRAMA',
     'TRAMA ITBA',
     'Espacio cultural y artístico del ITBA. Impulsa proyectos de arte, diseño y expresión cultural dentro de la comunidad universitaria.',
     'Culture', 'violet', 0, NULL),

    ('spe-eage',
     'SPE/EAGE',
     'SPE/EAGE Student Chapter ITBA',
     'Capítulo estudiantil conjunto de la Society of Petroleum Engineers y la European Association of Geoscientists and Engineers en el ITBA.',
     'Energy', 'green', 0, NULL),

    ('conexion',
     'CONEXION',
     'Conexión ITBA',
     'Medio de comunicación estudiantil del ITBA. Cubre noticias, opinión y vida universitaria desde la mirada de los alumnos.',
     'Media', 'amber', 0, NULL),

    ('ieee',
     'IEEE',
     'IEEE ITBA Student Branch',
     'Rama estudiantil del IEEE en el ITBA. Conecta a futuros ingenieros con la comunidad tecnológica global mediante charlas, workshops y proyectos.',
     'Tech', 'violet', 0, NULL),

    ('tech-trek',
     'Tech Trek',
     'Tech Trek ITBA',
     'Iniciativa que acerca a los estudiantes del ITBA al ecosistema de innovación y tecnología a través de viajes, visitas y networking con empresas líderes.',
     'Innovation', 'blue', 0, NULL),

    ('asme',
     'ASME',
     'ASME Student Section ITBA',
     'Sección estudiantil de la American Society of Mechanical Engineers en el ITBA. Organiza competencias, charlas técnicas y proyectos de ingeniería mecánica.',
     'Engineering', 'green', 0, NULL),

    ('aiche',
     'AIChE',
     'AIChE Student Chapter ITBA',
     'Capítulo estudiantil del American Institute of Chemical Engineers en el ITBA. Promueve la ingeniería química mediante actividades académicas y profesionales.',
     'Engineering', 'green', 0, NULL),

    ('emb',
     'EMB',
     'IEEE Engineering in Medicine and Biology Society',
     'Sociedad técnica del IEEE dedicada a la aplicación de la ingeniería a la medicina y la biología. Vincula a estudiantes con la bioingeniería y la salud digital.',
     'Bioengineering', 'violet', 0, NULL),

    ('turing',
     'Turing',
     'Club Turing ITBA',
     'Comunidad de estudiantes apasionados por la programación competitiva, la algoritmia y las ciencias de la computación.',
     'Tech', 'violet', 0, NULL),

    ('wie',
     'WIE',
     'IEEE Women in Engineering ITBA',
     'Grupo afín del IEEE que promueve la participación, el desarrollo profesional y la visibilidad de las mujeres en ingeniería y tecnología.',
     'Community', 'amber', 0, NULL),

    ('seds',
     'SEDS',
     'Students for the Exploration and Development of Space',
     'Capítulo estudiantil dedicado a la exploración y el desarrollo del espacio. Organiza charlas, proyectos y actividades vinculadas a la industria aeroespacial.',
     'Aerospace', 'blue', 0, NULL),

    ('computer-society',
     'Computer Society',
     'IEEE Computer Society ITBA',
     'Sociedad técnica del IEEE enfocada en computación, software y sistemas. Acerca a los estudiantes a las últimas tendencias de la industria.',
     'Tech', 'violet', 0, NULL),

    ('brainware',
     'Brainware',
     'Brainware ITBA',
     'Club de desarrollo de videojuegos del ITBA. Reúne a estudiantes interesados en game design, programación gráfica y producción de videojuegos.',
     'Game Dev', 'amber', 0, NULL)
ON CONFLICT (slug) DO NOTHING;
