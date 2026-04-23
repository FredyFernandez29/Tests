const express = require('express');
const db = require('../db');
const { isAuthenticated, hasPermission } = require('../middleware/auth');
const router = express.Router();

// Helper to get tickets based on role
function getTicketsForUser(user, callback) {
  let sql = `SELECT * FROM tickets`;
  let params = [];
  if (user.role === 'usuario') {
    sql += ` WHERE user_id = ?`;
    params = [user.id];
  }
  db.all(sql, params, callback);
}

// Get all tickets (role-filtered)
router.get('/', isAuthenticated, (req, res) => {
  getTicketsForUser(req.session.user, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get single ticket with activities
router.get('/:id', isAuthenticated, (req, res) => {
  const ticketId = req.params.id;
  db.get(`SELECT * FROM tickets WHERE id = ?`, [ticketId], (err, ticket) => {
    if (err || !ticket) return res.status(404).json({ error: 'Not found' });
    db.all(`SELECT * FROM activities WHERE ticket_id = ? ORDER BY date DESC, time DESC`, [ticketId], (err2, activities) => {
      res.json({ ticket, activities });
    });
  });
});

// Create new ticket
router.post('/', isAuthenticated, (req, res) => {
  const { title, category, priority, description, device, location } = req.body;
  if (!title || !category || !priority || !description || !device || !location) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const now = new Date();
  const dateStr = now.toISOString().slice(0,10);
  const timeStr = now.toTimeString().slice(0,5);
  const ticketId = 'TK-' + String(Date.now()).slice(-6);

  db.run(`
    INSERT INTO tickets (id, title, category, priority, status, description, device, location,
      user_id, user_name, user_email, tecnico, created, updated)
    VALUES (?, ?, ?, ?, 'Abierto', ?, ?, ?, ?, ?, ?, '', ?, ?)
  `, [ticketId, title, category, priority, description, device, location,
      req.session.user.id, req.session.user.name, req.session.user.email, dateStr, dateStr],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      // Add activity
      db.run(`INSERT INTO activities (ticket_id, by_name, text, time, date) VALUES (?, ?, ?, ?, ?)`,
        [ticketId, 'Sistema', `Ticket creado por ${req.session.user.name}`, timeStr, dateStr]);
      // Store cross-tab notification (could be done via WebSockets, but for simplicity, we'll rely on polling)
      res.json({ success: true, ticketId });
    });
});

// Update status (requires permission)
router.patch('/:id/status', isAuthenticated, hasPermission('sts'), (req, res) => {
  const { status } = req.body;
  const ticketId = req.params.id;
  const now = new Date();
  const dateStr = now.toISOString().slice(0,10);
  const timeStr = now.toTimeString().slice(0,5);
  db.run(`UPDATE tickets SET status = ?, updated = ? WHERE id = ?`, [status, dateStr, ticketId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run(`INSERT INTO activities (ticket_id, by_name, text, time, date) VALUES (?, ?, ?, ?, ?)`,
      [ticketId, req.session.user.name, `Estado cambiado a: ${status}`, timeStr, dateStr]);
    res.json({ success: true });
  });
});

// Assign technician (admin or tech with asg permission)
router.patch('/:id/assign', isAuthenticated, hasPermission('asg'), (req, res) => {
  const { tecnico } = req.body;
  const ticketId = req.params.id;
  const now = new Date();
  const dateStr = now.toISOString().slice(0,10);
  const timeStr = now.toTimeString().slice(0,5);
  db.run(`UPDATE tickets SET tecnico = ?, updated = ? WHERE id = ?`, [tecnico || '', dateStr, ticketId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run(`INSERT INTO activities (ticket_id, by_name, text, time, date) VALUES (?, ?, ?, ?, ?)`,
      [ticketId, req.session.user.name, `Ticket asignado a: ${tecnico || 'Sin asignar'}`, timeStr, dateStr]);
    res.json({ success: true });
  });
});

// Change priority (requires permission)
router.patch('/:id/priority', isAuthenticated, hasPermission('pri'), (req, res) => {
  const { priority } = req.body;
  const ticketId = req.params.id;
  const now = new Date();
  const dateStr = now.toISOString().slice(0,10);
  const timeStr = now.toTimeString().slice(0,5);
  db.run(`UPDATE tickets SET priority = ?, updated = ? WHERE id = ?`, [priority, dateStr, ticketId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run(`INSERT INTO activities (ticket_id, by_name, text, time, date) VALUES (?, ?, ?, ?, ?)`,
      [ticketId, req.session.user.name, `Prioridad cambiada a: ${priority}`, timeStr, dateStr]);
    res.json({ success: true });
  });
});

// Add comment
router.post('/:id/comment', isAuthenticated, (req, res) => {
  const { text } = req.body;
  const ticketId = req.params.id;
  if (!text) return res.status(400).json({ error: 'Comment required' });
  const now = new Date();
  const dateStr = now.toISOString().slice(0,10);
  const timeStr = now.toTimeString().slice(0,5);
  db.run(`INSERT INTO activities (ticket_id, by_name, text, time, date) VALUES (?, ?, ?, ?, ?)`,
    [ticketId, req.session.user.name, text, timeStr, dateStr], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      db.run(`UPDATE tickets SET updated = ? WHERE id = ?`, [dateStr, ticketId]);
      res.json({ success: true });
    });
});

// Delete ticket (admin or tech with del permission)
router.delete('/:id', isAuthenticated, hasPermission('del'), (req, res) => {
  const ticketId = req.params.id;
  db.run(`DELETE FROM activities WHERE ticket_id = ?`, [ticketId]);
  db.run(`DELETE FROM tickets WHERE id = ?`, [ticketId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

module.exports = router;