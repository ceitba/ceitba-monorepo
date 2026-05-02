/**
 * Seeds the organizations table from the frontend's static data.
 * Safe to run multiple times (ON CONFLICT DO NOTHING).
 *
 * Usage:  node src/seed.js
 */

import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const ORGANIZATIONS = [
  {
    slug: 'ceitba', name: 'CEITBA',
    fullName: 'Centro de Estudiantes del ITBA',
    description: 'El centro estudiantil que representa a todos los alumnos del ITBA.',
    category: 'General', color: 'blue', memberCount: 3800, foundedYear: 1984,
  },
  {
    slug: 'deportes', name: 'Club de Deportes',
    fullName: 'Club de Deportes ITBA',
    description: 'Organizamos torneos interuniversitarios, ligas internas y actividades físicas.',
    category: 'Sports', color: 'amber', memberCount: 620, foundedYear: 1991,
  },
  {
    slug: 'ieee', name: 'IEEE ITBA',
    fullName: 'IEEE ITBA Student Branch',
    description: 'Rama estudiantil del IEEE en el ITBA.',
    category: 'Tech', color: 'violet', memberCount: 280, foundedYear: 2003,
  },
  {
    slug: 'voluntariado', name: 'Voluntariado',
    fullName: 'Voluntariado ITBA',
    description: 'Impulsamos proyectos de responsabilidad social.',
    category: 'Culture', color: 'green', memberCount: 190, foundedYear: 2008,
  },
]

async function run() {
  const client = await pool.connect()
  try {
    for (const o of ORGANIZATIONS) {
      await client.query(
        `INSERT INTO organizations (slug, name, full_name, description, category, color, member_count, founded_year)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (slug) DO NOTHING`,
        [o.slug, o.name, o.fullName, o.description, o.category, o.color, o.memberCount, o.foundedYear]
      )
    }
    console.log(`seeded ${ORGANIZATIONS.length} organizations`)
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((err) => { console.error(err); process.exit(1) })
