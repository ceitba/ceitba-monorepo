/**
 * Simple migration runner.
 * Reads *.sql files from ../migrations/ in alphabetical order,
 * skips files already recorded in schema_migrations.
 *
 * Usage:  node src/migrate.js
 */

import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dir = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dir, '..', 'migrations')

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function run() {
  const client = await pool.connect()
  try {
    // Ensure the bookkeeping table exists first
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT now()
      )
    `)

    const { rows: applied } = await client.query('SELECT filename FROM schema_migrations')
    const done = new Set(applied.map((r) => r.filename))

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      if (done.has(file)) {
        console.log(`skip  ${file}`)
        continue
      }
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`apply ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
    console.log('migrations done')
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((err) => { console.error(err); process.exit(1) })
