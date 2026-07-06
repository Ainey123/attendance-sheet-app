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

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    console.log('Connected to Postgres. Running schema...');

    // Split statements by semicolon and execute sequentially to avoid issues
    // with very large single-query executions. This naive split works for
    // straightforward schema files that end statements with semicolons.
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

    console.log('Schema migration finished.');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await client.end();
  }
}

run();
