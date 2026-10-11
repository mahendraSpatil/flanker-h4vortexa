// Owner: Archit (frozen; ask before changing) | Opens the SQLite database (WAL, foreign keys) and applies the schema
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const SCHEMA_SQL = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(SCHEMA_SQL);
