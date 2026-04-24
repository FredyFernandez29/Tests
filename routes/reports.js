const express = require('express');
const db = require('../db');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const router = express.Router();

// Get filtered tickets for reports (admin/tech with rep permission)
router.post('/filter', isAuthenticated, hasPermission('rep'), (req, res) => {
  const { desde, hasta, status, priority, category } = req.body;
  let sql = `SELECT * FROM tickets WHERE 1=1`;
  let params = [];
  if (desde) { sql += ` AND created >= ?`; params.push(desde); }
  if (hasta) { sql += ` AND created <= ?`; params.push(hasta); }
  if (status && status !== '') { sql += ` AND status = ?`; params.push(status); }
  if (priority && priority !== '') { sql += ` AND priority = ?`; params.push(priority); }
  if (category && category !== '') { sql += ` AND category = ?`; params.push(category); }

  // If not admin, filter by own tickets? For reports, admin sees all, tech sees all (they have rep perm), usuario can't access reports.
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

module.exports = router;