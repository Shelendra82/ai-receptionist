import sqlite3 from 'sqlite3';
import { promisify } from 'util';

// Initialize the database connection
const db = new sqlite3.Database('./receptionist.db', (err) => {
  if (err) {
    console.error('Error connecting to the database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    initializeDb();
  }
});

// Promisify database operations for async/await usage
export const dbRun = promisify(db.run.bind(db)) as any;
export const dbGet = promisify(db.get.bind(db)) as any;
export const dbAll = promisify(db.all.bind(db)) as any;

async function initializeDb() {
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_number TEXT UNIQUE,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        role TEXT, -- 'user' or 'assistant'
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        date TEXT,
        time TEXT,
        reason TEXT,
        status TEXT DEFAULT 'scheduled',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
      )
    `);

    console.log('Database tables initialized.');
  } catch (error) {
    console.error('Error initializing database tables:', error);
  }
}

export default db;
