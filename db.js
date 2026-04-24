const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const db = new sqlite3.Database(path.join(__dirname, 'database', 'fsatdesk.db'));

// Initialize tables
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      dept TEXT,
      active INTEGER DEFAULT 1,
      created TEXT,
      pass_changed TEXT,
      perms_del INTEGER DEFAULT 0,
      perms_sts INTEGER DEFAULT 0,
      perms_asg INTEGER DEFAULT 0,
      perms_pri INTEGER DEFAULT 0,
      perms_rep INTEGER DEFAULT 0
    )
  `);

  // Tickets table
  db.run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      description TEXT,
      device TEXT,
      location TEXT,
      user_id TEXT,
      user_name TEXT,
      user_email TEXT,
      tecnico TEXT,
      created TEXT,
      updated TEXT
    )
  `);

  // Activities table (for comments and history)
  db.run(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT,
      by_name TEXT,
      text TEXT,
      time TEXT,
      date TEXT,
      FOREIGN KEY(ticket_id) REFERENCES tickets(id)
    )
  `);

  // Insert default admin if not exists
  const adminId = 'u0';
  db.get(`SELECT id FROM users WHERE id = ?`, [adminId], async (err, row) => {
    if (!row) {
      const hash = await bcrypt.hash('Glotrans2022', 10);
      db.run(`
        INSERT INTO users (id, name, email, password_hash, role, dept, active, created, pass_changed,
          perms_del, perms_sts, perms_asg, perms_pri, perms_rep)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [adminId, 'Administrator', 'Administrator', hash, 'admin', 'TI', 1, new Date().toISOString().slice(0,10),
          new Date().toISOString().slice(0,10), 1, 1, 1, 1, 1]);
    }
  });
});

module.exports = db;