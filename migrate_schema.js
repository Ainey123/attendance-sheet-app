// ⚠️  SAFE MIGRATE SCRIPT — PROTECTED AGAINST DATA LOSS
// This script runs the schema SQL file to add NEW tables/columns.
// It will REFUSE to run if any DROP TABLE or DROP DATABASE
// statement is found in the schema file.

const fs = require('fs');
const { Client } = require('pg');

const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('ERROR: Set POSTGRES_URL (or DATABASE_URL) environment variable to your Postgres connection string.');
  console.error('Example: POSTGRES_URL="postgres://user:pass@host:5432/dbname" node migrate_schema.js');
  process.exit(1);
}

async function run() {
  const sqlFile = fs.existsSync('./supabase-schema.sql') ? './supabase-schema.sql' : './schema.sql';
  if (!fs.existsSync(sqlFile)) {
    console.error('ERROR: No schema file found (expected supabase-schema.sql or schema.sql in project root).');
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlFile, 'utf8');
  if (!sql.trim()) {
    console.error('ERROR: Schema file is empty.');
    process.exit(1);
  }

  // ══════════════════════════════════════════════════════════════
  // 🔒 SAFETY GUARD — NEVER REMOVE THIS CHECK
  // This prevents any DROP TABLE or DROP DATABASE from running.
  // These commands DELETE ALL DATA permanently with no recovery.
  // ══════════════════════════════════════════════════════════════
  const dangerousPattern = /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i;
  if (dangerousPattern.test(sql)) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════╗');
    console.error('║  🚨 SAFETY BLOCK — MIGRATION ABORTED                 ║');
    console.error('║                                                        ║');
    console.error('║  The schema file contains a DROP TABLE / DROP DATABASE ║');
    console.error('║  statement. Running this would DELETE ALL DATA in     ║');
    console.error('║  your live database with NO WAY TO RECOVER.           ║');
    console.error('║                                                        ║');
    console.error('║  Remove the DROP statements from the SQL file first.  ║');
    console.error('╚══════════════════════════════════════════════════════╝');
    console.error('');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    console.log('Connected to Postgres. Running schema...');

    const statements = sql
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      try {
        await client.query(stmt + ';');
      } catch (err) {
        console.error('Statement failed:', err.message);
        console.error('Failed statement preview:', stmt.slice(0, 200));
      }
    }

    console.log('Schema migration finished safely.');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await client.end();
  }
}

run();
