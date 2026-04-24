const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { isAuthenticated } = require('../middleware/auth');
const router = express.Router();

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  db.get(`SELECT * FROM users WHERE (email = ? OR name = ?) AND active = 1`, [email, email], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password expiry (except admin)
    const passDays = user.pass_changed ? (Date.now() - new Date(user.pass_changed).getTime()) / (1000*60*60*24) : 999;
    if (user.role !== 'admin' && passDays > 90) {
      return res.status(200).json({ requireChange: true, userId: user.id });
    }

    // Build perms object
    const perms = {
      del: !!user.perms_del,
      sts: !!user.perms_sts,
      asg: !!user.perms_asg,
      pri: !!user.perms_pri,
      rep: !!user.perms_rep
    };

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      dept: user.dept,
      perms: perms
    };

    res.json({ success: true, user: req.session.user });
  });
});

// Change password (for expiry or voluntary)
router.post('/change-password', isAuthenticated, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.session.user.id;
  db.get(`SELECT password_hash FROM users WHERE id = ?`, [userId], async (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'User not found' });
    const match = await bcrypt.compare(currentPassword, row.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });

    const newHash = await bcrypt.hash(newPassword, 10);
    db.run(`UPDATE users SET password_hash = ?, pass_changed = ? WHERE id = ?`, [newHash, new Date().toISOString().slice(0,10), userId]);
    res.json({ success: true });
  });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current session
router.get('/session', (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.json({ user: null });
  }
});

module.exports = router;