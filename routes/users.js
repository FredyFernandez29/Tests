const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { isAdmin } = require('../middleware/auth');
const router = express.Router();

// Get all users (admin only)
router.get('/', isAdmin, (req, res) => {
  db.all(`SELECT id, name, email, role, dept, active, created, pass_changed,
          perms_del, perms_sts, perms_asg, perms_pri, perms_rep FROM users`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Create user
router.post('/', isAdmin, async (req, res) => {
  const { name, email, password, role, dept, perms } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const id = 'u' + Date.now();
  const hash = await bcrypt.hash(password, 10);
  const nowStr = new Date().toISOString().slice(0,10);
  db.run(`
    INSERT INTO users (id, name, email, password_hash, role, dept, active, created, pass_changed,
      perms_del, perms_sts, perms_asg, perms_pri, perms_rep)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  `, [id, name, email, hash, role, dept || '', nowStr, nowStr,
      (perms && perms.del) ? 1 : 0,
      (perms && perms.sts) ? 1 : 0,
      (perms && perms.asg) ? 1 : 0,
      (perms && perms.pri) ? 1 : 0,
      (perms && perms.rep) ? 1 : 0], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id });
      });
});

// Update user
router.put('/:id', isAdmin, async (req, res) => {
  const userId = req.params.id;
  const { name, email, role, dept, active, perms, password } = req.body;
  if (userId === 'u0' && role !== 'admin') {
    return res.status(403).json({ error: 'Cannot change role of root admin' });
  }
  let sql = `UPDATE users SET name = ?, email = ?, role = ?, dept = ?, active = ?,
            perms_del = ?, perms_sts = ?, perms_asg = ?, perms_pri = ?, perms_rep = ?`;
  let params = [name, email, role, dept || '', active ? 1 : 0,
                perms.del ? 1 : 0, perms.sts ? 1 : 0, perms.asg ? 1 : 0, perms.pri ? 1 : 0, perms.rep ? 1 : 0];
  if (password && password.trim() !== '') {
    const hash = await bcrypt.hash(password, 10);
    sql += `, password_hash = ?, pass_changed = ?`;
    params.push(hash, new Date().toISOString().slice(0,10));
  }
  sql += ` WHERE id = ?`;
  params.push(userId);
  db.run(sql, params, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Delete user
router.delete('/:id', isAdmin, (req, res) => {
  const userId = req.params.id;
  if (userId === 'u0') return res.status(403).json({ error: 'Cannot delete root admin' });
  db.run(`DELETE FROM users WHERE id = ?`, [userId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

module.exports = router;