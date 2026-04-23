const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');

const authRoutes = require('./routes/auth');
const ticketRoutes = require('./routes/tickets');
const userRoutes = require('./routes/users');
const reportRoutes = require('./routes/reports');
const { isAuthenticated } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

app.use(session({
  secret: 'fsatdesk-secure-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 15 * 60 * 1000 } // 15 min
}));

// Make isAuthenticated available globally for routes that need it
app.use((req, res, next) => {
  req.isAuthenticated = () => !!req.session.user;
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reports', reportRoutes);

// Serve the main HTML for any other route (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`FSATDesk server running on http://localhost:${PORT}`);
});