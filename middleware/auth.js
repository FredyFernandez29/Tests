function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  res.status(403).json({ error: 'Forbidden' });
}

function hasPermission(perm) {
  return (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') return next();
    if (req.session.user && req.session.user.role === 'tecnico' && req.session.user.perms && req.session.user.perms[perm]) {
      return next();
    }
    res.status(403).json({ error: 'Insufficient permissions' });
  };
}

module.exports = { isAuthenticated, isAdmin, hasPermission };