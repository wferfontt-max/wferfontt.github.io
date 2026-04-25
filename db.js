/**
 * Database adapter – uses PostgreSQL when DATABASE_URL is set, SQLite otherwise.
 * All methods are async so routes are identical for both backends.
 */
const path = require('path');

const isPg = !!process.env.DATABASE_URL;
let adapter;

if (isPg) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // Convert SQLite-style ? placeholders to PostgreSQL $1, $2...
  function toPos(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  adapter = {
    isPg: true,
    pool,
    async all(sql, params = []) {
      const { rows } = await pool.query(toPos(sql), params);
      return rows;
    },
    async get(sql, params = []) {
      const { rows } = await pool.query(toPos(sql), params);
      return rows[0] ?? null;
    },
    async run(sql, params = []) {
      const trimmed = sql.trimStart().toUpperCase();
      // Auto-append RETURNING id for INSERT statements so we can get lastInsertRowid
      const finalSql = trimmed.startsWith('INSERT') && !trimmed.includes('RETURNING')
        ? toPos(sql) + ' RETURNING id'
        : toPos(sql);
      const { rows, rowCount } = await pool.query(finalSql, params);
      return { lastInsertRowid: rows[0]?.id ?? null, changes: rowCount };
    },
    async exec(sql) {
      // Execute multiple statements split by semicolon
      for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
        await pool.query(stmt);
      }
    },
  };
} else {
  const fs = require('fs');
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'furious.db');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new DatabaseSync(DB_PATH);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');

  adapter = {
    isPg: false,
    async all(sql, params = []) { return sqlite.prepare(sql).all(...params); },
    async get(sql, params = []) { return sqlite.prepare(sql).get(...params) ?? null; },
    async run(sql, params = []) {
      const r = sqlite.prepare(sql).run(...params);
      return { lastInsertRowid: r.lastInsertRowid, changes: r.changes };
    },
    async exec(sql) { sqlite.exec(sql); },
  };
}

module.exports = adapter;
