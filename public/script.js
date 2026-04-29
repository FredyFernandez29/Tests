// ==================== GLOBALS ====================
let currentUser = null;
let currentView = 'dash';
let ticketFilter = 'all';
let viewingTicketId = null;
let cachedTickets = [];
let cachedUsers = [];
let autoRefreshInterval = null;
let refreshCountdown = 30;
let refreshTimerInterval = null;
let notifPollInterval = null;
let lastNotifCheck = null;

// ==================== UTILITIES ====================
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"'`=/]/g, function(c) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;','=':'&#61;','/':'&#47;'})[c];
  });
}

function safeId(s) {
  s = String(s || '');
  return /^[A-Za-z0-9_\-]{1,40}$/.test(s) ? s : '';
}

function pad(n) { return n < 10 ? '0' + n : String(n); }

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById('screen-' + id);
  if (screen) screen.classList.add('active');
}

// ==================== API HELPERS ====================
async function apiCall(method, url, data, expectJson = true) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin'
  };
  if (data) options.body = JSON.stringify(data);
  const res = await fetch(url, options);
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const errData = await res.json();
      errorMsg = errData.error || errorMsg;
    } catch (e) {}
    throw new Error(errorMsg);
  }
  return expectJson ? res.json() : res;
}

// ==================== AUTH & SESSION ====================
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errDiv = document.getElementById('login-error');
  const lockDiv = document.getElementById('login-lock-msg');
  if (lockDiv) lockDiv.className = 'lock-msg';
  if (errDiv) errDiv.style.display = 'none';
  if (!email || !pass) {
    if (errDiv) { errDiv.textContent = 'Credenciales incorrectas.'; errDiv.style.display = 'block'; }
    return;
  }
  try {
    const data = await apiCall('POST', '/api/auth/login', { email, password: pass });
    if (data.requireChange) {
      window.pendingUserId = data.userId;
      document.getElementById('chpass-current').value = '';
      document.getElementById('chpass-new').value = '';
      document.getElementById('chpass-confirm').value = '';
      document.getElementById('chpass-error').style.display = 'none';
      const fill = document.getElementById('pwd-strength-fill');
      const lbl = document.getElementById('pwd-strength-label');
      if (fill) fill.style.width = '0%';
      if (lbl) lbl.textContent = '';
      showScreen('chpass');
      return;
    }
    currentUser = data.user;
    await afterLogin();
  } catch (err) {
    if (errDiv) { errDiv.textContent = err.message; errDiv.style.display = 'block'; }
  }
}

async function doChangePass() {
  const current = document.getElementById('chpass-current').value;
  const newp = document.getElementById('chpass-new').value;
  const confirm = document.getElementById('chpass-confirm').value;
  const errDiv = document.getElementById('chpass-error');
  if (!current || !newp || !confirm) {
    errDiv.textContent = 'Completa todos los campos.'; errDiv.style.display = 'block'; return;
  }
  if (newp !== confirm) {
    errDiv.textContent = 'Las contraseñas no coinciden.'; errDiv.style.display = 'block'; return;
  }
  try {
    await apiCall('POST', '/api/auth/change-password', { currentPassword: current, newPassword: newp });
    // Re-login with new password
    const email = currentUser ? currentUser.email : '';
    const data = await apiCall('POST', '/api/auth/login', { email, password: newp });
    currentUser = data.user;
    await afterLogin();
  } catch (err) {
    errDiv.textContent = err.message; errDiv.style.display = 'block';
  }
}

async function logout() {
  stopAutoRefresh();
  stopNotifPolling();
  await apiCall('POST', '/api/auth/logout', null, false);
  currentUser = null;
  viewingTicketId = null;
  cachedTickets = [];
  cachedUsers = [];
  document.getElementById('login-email').value = '';
  document.getElementById('login-pass').value = '';
  const errDiv = document.getElementById('login-error');
  if (errDiv) errDiv.style.display = 'none';
  showScreen('login');
}

async function afterLogin() {
  // Update navigation
  document.getElementById('nav-user-name').textContent = currentUser.name;
  const roleBadge = document.getElementById('nav-role-badge');
  roleBadge.textContent = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
  roleBadge.className = 'nav-role ' + currentUser.role;
  // Show/hide admin/tecnico menus
  const adminSec = document.getElementById('sidebar-admin-section');
  const tecSec = document.getElementById('sidebar-tecnico-section');
  if (adminSec) adminSec.style.display = currentUser.role === 'admin' ? 'block' : 'none';
  if (tecSec) tecSec.style.display = currentUser.role === 'tecnico' ? 'block' : 'none';
  // Refresh tecnico sidebar permissions
  if (currentUser.role === 'tecnico') refreshTecnicoSidebar();
  // Load initial data
  await loadUsers();
  await loadTickets();
  showScreen('main');
  navTo('dash', document.getElementById('nav-dash'));
  startAutoRefresh();
  startNotifPolling();
}

async function refreshTecnicoSidebar() {
  const repEl = document.getElementById('nav-reportes-tec');
  if (repEl) {
    repEl.style.display = (currentUser.perms && currentUser.perms.rep) ? 'flex' : 'none';
  }
}

// ==================== DATA LOADING ====================
async function loadTickets() {
  const tickets = await apiCall('GET', '/api/tickets');
  cachedTickets = tickets;
  return tickets;
}

async function loadUsers() {
  if (currentUser.role !== 'admin') return;
  const users = await apiCall('GET', '/api/users');
  cachedUsers = users;
  return users;
}

// ==================== NAVIGATION ====================
function navTo(view, el) {
  if (view === 'reportes' && currentUser.role === 'tecnico' && !(currentUser.perms && currentUser.perms.rep)) {
    showToast('No tienes permiso para ver Reportes');
    return;
  }
  currentView = view;
  if (el) {
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
  }
  const mc = document.getElementById('main-content');
  if (!mc) return;
  if (view === 'dash') mc.innerHTML = renderDash();
  else if (view === 'tickets') mc.innerHTML = renderTickets();
  else if (view === 'nuevo-ticket') mc.innerHTML = renderNewTicketForm();
  else if (view === 'usuarios') mc.innerHTML = renderUsers();
  else if (view === 'reportes') mc.innerHTML = renderReports();
  else if (view === 'ticket-detail') mc.innerHTML = renderTicketDetail(viewingTicketId);
  resetRefreshCountdown();
}

// ==================== DASHBOARD ====================
function getMyTickets() {
  if (currentUser.role === 'admin') return cachedTickets;
  if (currentUser.role === 'tecnico') return cachedTickets;
  return cachedTickets.filter(t => t.user_id === currentUser.id);
}

function renderDash() {
  const all = getMyTickets();
  const open = all.filter(t => t.status === 'Abierto').length;
  const prog = all.filter(t => t.status === 'En progreso').length;
  const closed = all.filter(t => t.status === 'Cerrado').length;
  const high = all.filter(t => t.priority === 'Alta').length;
  const recent = all.slice(0, 5);
  let html = '<div class="section-header"><h2>Dashboard</h2></div>';
  html += '<div class="stats-row">';
  html += `<div class="stat-card"><div class="stat-label">Total</div><div class="stat-value c-blue">${all.length}</div></div>`;
  html += `<div class="stat-card"><div class="stat-label">Abiertos</div><div class="stat-value c-amber">${open}</div></div>`;
  html += `<div class="stat-card"><div class="stat-label">En progreso</div><div class="stat-value" style="color:var(--warn)">${prog}</div></div>`;
  html += `<div class="stat-card"><div class="stat-label">Cerrados</div><div class="stat-value c-green">${closed}</div></div>`;
  html += '</div>';
  if (currentUser.role === 'admin') {
    const totU = cachedUsers.filter(u => u.role === 'usuario').length;
    const totT = cachedUsers.filter(u => u.role === 'tecnico').length;
    html += '<div class="stats-row" style="margin-bottom:28px">';
    html += `<div class="stat-card"><div class="stat-label">Alta Prioridad</div><div class="stat-value c-red">${high}</div></div>`;
    html += `<div class="stat-card"><div class="stat-label">Usuarios</div><div class="stat-value c-purple">${totU}</div></div>`;
    html += `<div class="stat-card"><div class="stat-label">Tecnicos</div><div class="stat-value c-blue">${totT}</div></div>`;
    html += `<div class="stat-card"><div class="stat-label">Total usuarios</div><div class="stat-value">${cachedUsers.length}</div></div>`;
    html += '</div>';
  }
  html += '<div class="section-header"><h2>Tickets recientes</h2></div>';
  html += renderTicketRows(recent);
  return html;
}

// ==================== TICKETS LIST ====================
function renderTickets() {
  let html = '<div class="section-header"><h2>Tickets de soporte</h2>';
  if (currentUser.role !== 'admin' && currentUser.role !== 'tecnico') {
    html += '<button class="btn-nav btn-primary" onclick="navTo(\'nuevo-ticket\',document.getElementById(\'nav-nuevo-ticket\'))">+ Nuevo ticket</button>';
  }
  html += '</div><div class="filter-row">';
  const filters = [['all','Todos'],['Abierto','Abiertos'],['En progreso','En progreso'],['Cerrado','Cerrados'],['Alta','Prioridad Alta'],['Media','Prioridad Media'],['Baja','Prioridad Baja']];
  filters.forEach(f => {
    html += `<button class="filter-btn ${ticketFilter === f[0] ? 'active' : ''}" onclick="setFilter('${f[0]}')">${f[1]}</button>`;
  });
  html += '</div>';
  let filtered = getMyTickets();
  if (ticketFilter === 'Abierto' || ticketFilter === 'En progreso' || ticketFilter === 'Cerrado')
    filtered = filtered.filter(t => t.status === ticketFilter);
  if (ticketFilter === 'Alta' || ticketFilter === 'Media' || ticketFilter === 'Baja')
    filtered = filtered.filter(t => t.priority === ticketFilter);
  html += renderTicketRows(filtered);
  return html;
}

function setFilter(f) {
  ticketFilter = f;
  navTo('tickets', document.getElementById('nav-tickets'));
}

function canDeleteTicket() {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role === 'tecnico' && currentUser.perms && currentUser.perms.del) return true;
  return false;
}

async function deleteTicket(id, evt) {
  if (evt) evt.stopPropagation();
  if (!safeId(id)) return;
  if (!confirm(`Confirmar eliminacion del ticket ${id}?\nEsta accion no se puede deshacer.`)) return;
  try {
    await apiCall('DELETE', `/api/tickets/${id}`);
    showToast(`Ticket ${id} eliminado correctamente`);
    await loadTickets();
    if (currentView === 'ticket-detail') navTo('tickets', document.getElementById('nav-tickets'));
    else navTo(currentView, null);
  } catch (err) {
    showToast(err.message);
  }
}

function renderTicketRows(tickets) {
  if (!tickets.length) return '<div class="empty">No hay tickets que mostrar.</div>';
  const canDel = canDeleteTicket();
  let html = '<div class="ticket-list">';
  tickets.forEach(t => {
    const sid = safeId(t.id);
    if (!sid) return;
    html += `<div class="ticket-item">`;
    html += `<div class="ticket-id" onclick="openTicket('${sid}')" style="cursor:pointer">${esc(t.id)}</div>`;
    html += `<div onclick="openTicket('${sid}')" style="cursor:pointer"><div class="ticket-title">${esc(t.title)}</div><div class="ticket-meta">${esc(t.user_name)} &bull; ${esc(t.category)} &bull; ${esc(t.created)}</div></div>`;
    html += `<span class="badge badge-${t.priority === 'Alta' ? 'high' : t.priority === 'Media' ? 'medium' : 'low'}">${esc(t.priority)}</span>`;
    html += `<span class="badge badge-${t.status === 'Abierto' ? 'open' : t.status === 'En progreso' ? 'progress' : 'closed'}">${esc(t.status)}</span>`;
    if (canDel) {
      html += `<button class="tk-del-btn" onclick="deleteTicket('${sid}',event)" title="Eliminar ticket">&#128465;</button>`;
    } else {
      html += `<span></span>`;
    }
    html += `</div>`;
  });
  html += '</div>';
  return html;
}

function openTicket(id) {
  if (!safeId(id)) return;
  viewingTicketId = id;
  navTo('ticket-detail', null);
}

// ==================== TICKET DETAIL ====================
async function renderTicketDetail(id) {
  try {
    const data = await apiCall('GET', `/api/tickets/${id}`);
    const t = data.ticket;
    const activities = data.activities || [];
    if (!t) return '<div class="empty">Ticket no encontrado.</div>';
    const isAdmin = currentUser.role === 'admin';
    const isTecnico = currentUser.role === 'tecnico';
    const perms = currentUser.perms || {};
    const canDel = isAdmin || (isTecnico && perms.del);
    const canSts = isAdmin || (isTecnico && perms.sts);
    const canAsg = isAdmin || (isTecnico && perms.asg);
    const canPri = isAdmin || (isTecnico && perms.pri);
    let html = '<div style="display:flex;gap:10px;align-items:center;margin-bottom:20px;flex-wrap:wrap">';
    html += '<button class="btn-nav" onclick="navTo(\'tickets\',document.getElementById(\'nav-tickets\'))">&#8592; Volver a tickets</button>';
    if (canDel) html += `<button class="btn-nav btn-danger" onclick="deleteTicket('${safeId(t.id)}',event)">&#128465; Eliminar ticket</button>`;
    html += '</div><div class="detail-header"><div>';
    html += `<div class="detail-title">${esc(t.title)}</div><div class="detail-badges">`;
    html += `<span class="badge badge-${t.status === 'Abierto' ? 'open' : t.status === 'En progreso' ? 'progress' : 'closed'}">${esc(t.status)}</span>`;
    html += `<span class="badge badge-${t.priority === 'Alta' ? 'high' : t.priority === 'Media' ? 'medium' : 'low'}">${esc(t.priority)}</span>`;
    html += `<span class="badge" style="background:var(--surface2);color:var(--muted)">${esc(t.category)}</span>`;
    html += `</div></div><span style="font-family:var(--mono);font-size:13px;color:var(--muted)">${esc(t.id)}</span></div>`;
    html += '<div class="detail-grid"><div>';
    html += `<div class="detail-section"><h3>Descripcion</h3><p class="detail-desc" style="white-space:pre-wrap">${esc(t.description)}</p></div>`;
    html += '<div class="detail-section"><h3>Actividad</h3>';
    activities.forEach(a => {
      html += `<div class="activity-item"><div class="activity-avatar">${esc(String(a.by_name||'?').charAt(0))}</div>`;
      html += `<div><div class="activity-text"><strong>${esc(a.by_name)}</strong>: ${esc(a.text)}</div>`;
      html += `<div class="activity-time">${esc(a.date)} ${esc(a.time)}</div></div></div>`;
    });
    html += `<div style="margin-top:14px;display:flex;gap:8px"><input type="text" id="comment-input" placeholder="Agregar comentario..." style="flex:1;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:var(--font)"/>`;
    html += `<button onclick="addComment('${safeId(t.id)}')" class="btn-nav btn-primary">Enviar</button></div></div></div>`;
    html += '<div><div class="detail-section"><h3>Informacion</h3>';
    html += `<div class="info-row"><span class="info-label">Solicitante</span><span class="info-val">${esc(t.user_name)}</span></div>`;
    html += `<div class="info-row"><span class="info-label">Correo</span><span class="info-val" style="font-size:12px">${esc(t.user_email)}</span></div>`;
    html += `<div class="info-row"><span class="info-label">Dispositivo</span><span class="info-val">${esc(t.device||'---')}</span></div>`;
    html += `<div class="info-row"><span class="info-label">Ubicacion</span><span class="info-val">${esc(t.location||'---')}</span></div>`;
    html += `<div class="info-row"><span class="info-label">Creado</span><span class="info-val">${esc(t.created)}</span></div>`;
    html += `<div class="info-row"><span class="info-label">Tecnico asignado</span><span class="info-val">${esc(t.tecnico||'Sin asignar')}</span></div>`;
    if (canSts) {
      html += `<div style="margin-top:14px"><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px;font-weight:500">Cambiar estado</label>`;
      html += `<select onchange="changeStatus('${safeId(t.id)}',this.value)" style="width:100%;padding:9px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:var(--font)">`;
      ['Abierto','En progreso','Cerrado'].forEach(s => {
        html += `<option${t.status === s ? ' selected' : ''}>${s}</option>`;
      });
      html += `</select></div>`;
    }
    if (isAdmin) {
      const tecnicos = cachedUsers.filter(u => u.role === 'tecnico');
      html += `<div style="margin-top:12px"><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px;font-weight:500">Asignar tecnico</label>`;
      html += `<select onchange="assignTecnico('${safeId(t.id)}',this.value)" style="width:100%;padding:9px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:var(--font)">`;
      html += `<option value="">Sin asignar</option>`;
      tecnicos.forEach(u => {
        html += `<option value="${esc(u.name)}"${t.tecnico === u.name ? ' selected' : ''}>${esc(u.name)}</option>`;
      });
      html += `</select></div>`;
    } else if (canAsg) {
      const esSuyo = t.tecnico === currentUser.name;
      html += `<div style="margin-top:12px">`;
      if (!esSuyo) {
        html += `<button class="btn-nav btn-primary" style="width:100%" onclick="assignTecnico('${safeId(t.id)}','${esc(currentUser.name).replace(/\\/g,"\\\\").replace(/\x27/g,"\\x27")}')">Asignarme este ticket</button>`;
      } else {
        html += `<button class="btn-nav" style="width:100%" onclick="assignTecnico('${safeId(t.id)}','')">Liberar asignación</button>`;
      }
      html += `</div>`;
    }
    if (canPri) {
      html += `<div style="margin-top:12px"><label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px;font-weight:500">Cambiar prioridad</label>`;
      html += `<select onchange="changePriority('${safeId(t.id)}',this.value)" style="width:100%;padding:9px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:var(--font)">`;
      ['Alta','Media','Baja'].forEach(p => {
        html += `<option${t.priority === p ? ' selected' : ''}>${p}</option>`;
      });
      html += `</select></div>`;
    }
    html += '</div></div></div></div>';
    return html;
  } catch (err) {
    return `<div class="empty">Error cargando ticket: ${err.message}</div>`;
  }
}

async function addComment(id) {
  const inp = document.getElementById('comment-input');
  const txt = inp ? inp.value.trim() : '';
  if (!txt) return;
  if (!safeId(id)) return;
  try {
    await apiCall('POST', `/api/tickets/${id}/comment`, { text: txt });
    showToast('Comentario agregado');
    if (currentView === 'ticket-detail' && viewingTicketId === id) {
      document.getElementById('main-content').innerHTML = await renderTicketDetail(id);
    }
    await loadTickets();
  } catch (err) {
    showToast(err.message);
  }
}

async function changeStatus(id, newStatus) {
  if (!safeId(id)) return;
  try {
    await apiCall('PATCH', `/api/tickets/${id}/status`, { status: newStatus });
    showToast('Estado actualizado: ' + newStatus);
    if (currentView === 'ticket-detail' && viewingTicketId === id) {
      document.getElementById('main-content').innerHTML = await renderTicketDetail(id);
    }
    await loadTickets();
  } catch (err) {
    showToast(err.message);
  }
}

async function assignTecnico(id, name) {
  if (!safeId(id)) return;
  try {
    await apiCall('PATCH', `/api/tickets/${id}/assign`, { tecnico: name });
    showToast('Tecnico asignado');
    if (currentView === 'ticket-detail' && viewingTicketId === id) {
      document.getElementById('main-content').innerHTML = await renderTicketDetail(id);
    }
    await loadTickets();
  } catch (err) {
    showToast(err.message);
  }
}

async function changePriority(id, priority) {
  if (!safeId(id)) return;
  try {
    await apiCall('PATCH', `/api/tickets/${id}/priority`, { priority });
    showToast('Prioridad actualizada');
    if (currentView === 'ticket-detail' && viewingTicketId === id) {
      document.getElementById('main-content').innerHTML = await renderTicketDetail(id);
    }
    await loadTickets();
  } catch (err) {
    showToast(err.message);
  }
}

// ==================== NEW TICKET ====================
function checkTicketForm() {
  const title = document.getElementById('t-title')?.value || '';
  const cat = document.getElementById('t-category')?.value || '';
  const pri = document.getElementById('t-priority')?.value || '';
  const desc = document.getElementById('t-desc')?.value || '';
  const dev = document.getElementById('t-device')?.value || '';
  const loc = document.getElementById('t-location')?.value || '';
  const btn = document.getElementById('btn-submit-ticket');
  if (!btn) return;
  const ok = title.trim() && cat && pri && desc.trim() && dev.trim() && loc.trim();
  btn.disabled = !ok;
  btn.style.opacity = ok ? '1' : '0.45';
  btn.style.cursor = ok ? 'pointer' : 'not-allowed';
}

function renderNewTicketForm() {
  return `<div class="form-card">
    <div class="form-header"><h2>Crear nuevo ticket</h2><p>Describe el problema y el equipo tecnico te ayudara lo antes posible.</p></div>
    <div class="form-row"><label>Titulo del problema *</label><input type="text" id="t-title" placeholder="Ej: La computadora no enciende" oninput="checkTicketForm()" maxlength="120"/></div>
    <div class="form-grid">
      <div class="form-row"><label>Categoria *</label><select id="t-category" onchange="checkTicketForm()"><option value="">Seleccionar...</option>
        ${['Hardware','Software','Red / Internet','Impresora','Correo electronico','Sistema operativo','Otro'].map(c => `<option>${c}</option>`).join('')}
      </select></div>
      <div class="form-row"><label>Prioridad *</label><select id="t-priority" onchange="checkTicketForm()"><option value="">Seleccionar...</option><option>Alta</option><option>Media</option><option>Baja</option></select></div>
    </div>
    <div class="form-row"><label>Descripcion detallada *</label><textarea id="t-desc" placeholder="Cuando ocurrio? Que estabas haciendo? Que mensajes aparecen?" oninput="checkTicketForm()" maxlength="2000"></textarea></div>
    <div class="form-grid">
      <div class="form-row"><label>Equipo / Dispositivo *</label><input type="text" id="t-device" placeholder="Ej: Dell Latitude" oninput="checkTicketForm()" maxlength="80"/></div>
      <div class="form-row"><label>Ubicacion / Departamento *</label><input type="text" id="t-location" placeholder="Ej: Contabilidad piso 2" oninput="checkTicketForm()" maxlength="80"/></div>
    </div>
    <button id="btn-submit-ticket" class="btn-submit" onclick="submitTicket()" disabled style="opacity:0.45;cursor:not-allowed">Enviar ticket de soporte</button>
  </div>`;
}

async function submitTicket() {
  const title = document.getElementById('t-title').value.trim();
  const category = document.getElementById('t-category').value;
  const priority = document.getElementById('t-priority').value;
  const description = document.getElementById('t-desc').value.trim();
  const device = document.getElementById('t-device').value.trim();
  const location = document.getElementById('t-location').value.trim();
  if (!title || !category || !priority || !description || !device || !location) {
    showToast('Por favor completa todos los campos requeridos (*)');
    return;
  }
  try {
    const res = await apiCall('POST', '/api/tickets', { title, category, priority, description, device, location });
    showToast(`Ticket ${res.ticketId} creado exitosamente`);
    await loadTickets();
    ticketFilter = 'all';
    navTo('tickets', document.getElementById('nav-tickets'));
  } catch (err) {
    showToast(err.message);
  }
}

// ==================== USERS (ADMIN) ====================
function renderUsers() {
  if (currentUser.role !== 'admin') return '<div class="empty">Acceso denegado</div>';
  let html = '<div class="section-header"><h2>Gestion de usuarios</h2>';
  html += '<button class="btn-nav btn-primary" onclick="openModal(null)">+ Nuevo usuario</button></div>';
  html += '<div class="table-wrap"><table><thead><tr>';
  ['Nombre','Correo','Rol','Departamento','Permisos','Estado','Acciones'].forEach(h => html += `<th>${h}</th>`);
  html += '</tr></thead><tbody>';
  cachedUsers.forEach(u => {
    html += `<tr><td><strong>${esc(u.name)}</strong></td>`;
    html += `<td>${esc(u.email)}</td>`;
    html += `<td><span class="badge badge-${u.role === 'admin' ? 'admin' : u.role === 'tecnico' ? 'open' : 'closed'}">${esc(u.role)}</span></td>`;
    html += `<td>${esc(u.dept || '---')}</td>`;
    if (u.role === 'tecnico') {
      const perms = [];
      if (u.perms_del) perms.push('Eliminar');
      if (u.perms_sts) perms.push('Estado');
      if (u.perms_asg) perms.push('Asignar');
      if (u.perms_pri) perms.push('Prioridad');
      if (u.perms_rep) perms.push('Reportes');
      html += `<td style="font-size:11px;color:var(--muted)">${perms.length ? perms.join(', ') : 'Sin permisos'}</td>`;
    } else {
      html += `<td style="font-size:11px;color:var(--muted)">${u.role === 'admin' ? 'Acceso total' : '---'}</td>`;
    }
    html += `<td><span class="badge ${u.active ? 'badge-closed' : 'badge-high'}">${u.active ? 'Activo' : 'Inactivo'}</span></td>`;
    html += `<td><div class="action-btns">`;
    if (u.id !== 'u0') {
      html += `<button class="btn-sm edit" onclick="openModal('${safeId(u.id)}')">Editar</button>`;
      html += `<button class="btn-sm" onclick="toggleUser('${safeId(u.id)}')">${u.active ? 'Desactivar' : 'Activar'}</button>`;
      html += `<button class="btn-sm del" onclick="deleteUser('${safeId(u.id)}')">Eliminar</button>`;
    } else {
      html += `<button class="btn-sm edit" onclick="openModal('${safeId(u.id)}')">Editar</button>`;
      html += `<span style="font-size:12px;color:var(--muted);margin-left:6px">Sistema</span>`;
    }
    html += `</div></td></tr>`;
  });
  html += '</tbody></table></div>';
  return html;
}

function togglePermisos() {
  const rol = document.getElementById('mu-rol').value;
  document.getElementById('perm-section').style.display = (rol === 'tecnico') ? 'block' : 'none';
}

function openModal(userId) {
  if (currentUser.role !== 'admin') return;
  const modal = document.getElementById('modal-user');
  const editingId = userId;
  if (editingId) {
    const u = cachedUsers.find(x => x.id === editingId);
    if (!u) return;
    document.getElementById('modal-title').textContent = 'Editar usuario';
    document.getElementById('mu-name').value = u.name;
    document.getElementById('mu-email').value = u.email;
    document.getElementById('mu-pass').value = '';
    document.getElementById('mu-pass').setAttribute('placeholder', 'Dejar vacío para no cambiar');
    document.getElementById('mu-rol').value = u.role;
    document.getElementById('mu-dept').value = u.dept || '';
    const isAdminU0 = (editingId === 'u0');
    document.getElementById('mu-name').readOnly = isAdminU0;
    document.getElementById('mu-email').readOnly = isAdminU0;
    document.getElementById('mu-rol').disabled = isAdminU0;
    document.getElementById('mu-dept').readOnly = isAdminU0;
    if (isAdminU0) document.getElementById('modal-title').textContent = 'Cambiar contraseña - Administrator';
    if (u.role === 'tecnico') {
      document.getElementById('perm-section').style.display = 'block';
      document.getElementById('perm-del').checked = !!u.perms_del;
      document.getElementById('perm-sts').checked = !!u.perms_sts;
      document.getElementById('perm-asg').checked = !!u.perms_asg;
      document.getElementById('perm-pri').checked = !!u.perms_pri;
      document.getElementById('perm-rep').checked = !!u.perms_rep;
    } else {
      document.getElementById('perm-section').style.display = 'none';
    }
  } else {
    document.getElementById('modal-title').textContent = 'Crear usuario';
    document.getElementById('mu-name').value = '';
    document.getElementById('mu-email').value = '';
    document.getElementById('mu-pass').value = '';
    document.getElementById('mu-rol').value = 'usuario';
    document.getElementById('mu-dept').value = '';
    document.getElementById('mu-name').readOnly = false;
    document.getElementById('mu-email').readOnly = false;
    document.getElementById('mu-rol').disabled = false;
    document.getElementById('mu-dept').readOnly = false;
    document.getElementById('perm-del').checked = true;
    document.getElementById('perm-sts').checked = true;
    document.getElementById('perm-asg').checked = true;
    document.getElementById('perm-pri').checked = false;
    document.getElementById('perm-rep').checked = true;
    document.getElementById('perm-section').style.display = 'none';
  }
  modal.classList.add('open');
}

function closeModal() {
  document.getElementById('modal-user').classList.remove('open');
}

async function saveUser() {
  const name = document.getElementById('mu-name').value.trim();
  const email = document.getElementById('mu-email').value.trim();
  const pass = document.getElementById('mu-pass').value;
  const rol = document.getElementById('mu-rol').value;
  const dept = document.getElementById('mu-dept').value.trim();
  const editing = document.getElementById('modal-title').textContent.includes('Editar') || document.getElementById('modal-title').textContent.includes('Cambiar');
  const editingId = editing ? (document.getElementById('mu-name').readOnly ? 'u0' : cachedUsers.find(u => u.name === document.getElementById('mu-name').value)?.id) : null;
  if (!name || !email) { showToast('Completa los campos requeridos'); return; }
  const emailRegex = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
  if (email !== 'Administrator' && !emailRegex.test(email)) { showToast('Correo inválido'); return; }
  if (!editing && !pass) { showToast('La contraseña es obligatoria'); return; }
  if (!editing && rol !== 'admin') {
    const errs = [];
    if (pass.length < 8) errs.push('Mínimo 8 caracteres');
    if (!/[A-Z]/.test(pass)) errs.push('Mayúscula');
    if (!/[a-z]/.test(pass)) errs.push('Minúscula');
    if (!/[0-9]/.test(pass)) errs.push('Número');
    if (!/[^A-Za-z0-9]/.test(pass)) errs.push('Símbolo');
    if (errs.length) { showToast('Contraseña insegura: ' + errs.join(', ')); return; }
  }
  const perms = {
    del: document.getElementById('perm-del')?.checked || false,
    sts: document.getElementById('perm-sts')?.checked || false,
    asg: document.getElementById('perm-asg')?.checked || false,
    pri: document.getElementById('perm-pri')?.checked || false,
    rep: document.getElementById('perm-rep')?.checked || false
  };
  try {
    if (editing && editingId) {
      const userData = { name, email, role: rol, dept, active: true, perms };
      if (pass && pass.trim() !== '') userData.password = pass;
      await apiCall('PUT', `/api/users/${editingId}`, userData);
      showToast('Usuario actualizado');
    } else {
      await apiCall('POST', '/api/users', { name, email, password: pass, role: rol, dept, perms });
      showToast('Usuario creado exitosamente');
    }
    await loadUsers();
    closeModal();
    navTo('usuarios', document.getElementById('nav-usuarios'));
  } catch (err) {
    showToast(err.message);
  }
}

async function toggleUser(id) {
  if (id === 'u0') { showToast('No se puede desactivar al admin raíz'); return; }
  const u = cachedUsers.find(x => x.id === id);
  if (!u) return;
  try {
    await apiCall('PUT', `/api/users/${id}`, { ...u, active: !u.active, perms: { del: u.perms_del, sts: u.perms_sts, asg: u.perms_asg, pri: u.perms_pri, rep: u.perms_rep } });
    await loadUsers();
    navTo('usuarios', document.getElementById('nav-usuarios'));
    showToast(`Usuario ${u.active ? 'desactivado' : 'activado'}`);
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteUser(id) {
  if (id === 'u0') { showToast('No se puede eliminar al admin raíz'); return; }
  if (!confirm('Confirmar eliminacion del usuario?')) return;
  try {
    await apiCall('DELETE', `/api/users/${id}`);
    await loadUsers();
    navTo('usuarios', document.getElementById('nav-usuarios'));
    showToast('Usuario eliminado');
  } catch (err) {
    showToast(err.message);
  }
}

// ==================== REPORTS ====================
function renderReports() {
  if (currentUser.role !== 'admin' && !(currentUser.perms && currentUser.perms.rep)) {
    return '<div class="empty">No tienes permiso para ver reportes.</div>';
  }
  let html = '<div class="section-header"><h2>Reportes y estadisticas</h2>';
  html += '<div class="export-btns">';
  html += '<button class="btn-export" onclick="exportCSV()"><svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Exportar CSV</button>';
  html += '<button class="btn-export-pdf" onclick="exportPDF()"><svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/></svg> Exportar PDF</button>';
  html += '</div></div>';
  html += '<div class="report-filters" id="report-filters-container">';
  html += '<div class="rf-group"><label>Fecha desde</label><input type="date" id="rf-desde" value="2026-04-01" onchange="updateReports()"/></div>';
  html += '<div class="rf-group"><label>Fecha hasta</label><input type="date" id="rf-hasta" value="2026-04-23" onchange="updateReports()"/></div>';
  html += '<div class="rf-group"><label>Estado</label><select id="rf-status" onchange="updateReports()"><option value="">Todos</option><option>Abierto</option><option>En progreso</option><option>Cerrado</option></select></div>';
  html += '<div class="rf-group"><label>Prioridad</label><select id="rf-priority" onchange="updateReports()"><option value="">Todas</option><option>Alta</option><option>Media</option><option>Baja</option></select></div>';
  html += '<div class="rf-group"><label>Categoria</label><select id="rf-cat" onchange="updateReports()"><option value="">Todas</option>';
  ['Hardware','Software','Red / Internet','Impresora','Correo electronico','Sistema operativo','Otro'].forEach(c => html += `<option>${c}</option>`);
  html += '</select></div></div>';
  html += '<div id="report-body">... cargando ...</div>';
  setTimeout(() => updateReports(), 50);
  return html;
}

async function updateReports() {
  const container = document.getElementById('report-body');
  if (!container) return;
  const desde = document.getElementById('rf-desde')?.value || '';
  const hasta = document.getElementById('rf-hasta')?.value || '';
  const status = document.getElementById('rf-status')?.value || '';
  const priority = document.getElementById('rf-priority')?.value || '';
  const category = document.getElementById('rf-cat')?.value || '';
  try {
    const tickets = await apiCall('POST', '/api/reports/filter', { desde, hasta, status, priority, category });
    container.innerHTML = buildReportBody(tickets);
  } catch (err) {
    container.innerHTML = `<div class="empty">Error cargando reportes: ${err.message}</div>`;
  }
}

function buildReportBody(tickets) {
  const total = tickets.length;
  const open = tickets.filter(t => t.status === 'Abierto').length;
  const prog = tickets.filter(t => t.status === 'En progreso').length;
  const closed = tickets.filter(t => t.status === 'Cerrado').length;
  const high = tickets.filter(t => t.priority === 'Alta').length;
  const med = tickets.filter(t => t.priority === 'Media').length;
  const low = tickets.filter(t => t.priority === 'Baja').length;
  const cats = {};
  tickets.forEach(t => cats[t.category] = (cats[t.category] || 0) + 1);
  const catColors = ['#1a56db','#1d9e75','#ba7517','#a32d2d','#7c3aed','#0891b2','#059669'];
  let ci = 0;
  let html = '<div class="report-summary">';
  html += `<div class="summary-card"><div class="val c-blue">${total}</div><div class="lbl">Total en periodo</div></div>`;
  html += `<div class="summary-card"><div class="val c-green">${closed}</div><div class="lbl">Resueltos</div></div>`;
  html += `<div class="summary-card"><div class="val c-red">${high}</div><div class="lbl">Alta prioridad</div></div></div>`;
  html += '<div class="report-section"><h3>Por estado</h3><div class="chart-bar-wrap">';
  [[ 'Abierto', open, '#185fa5' ], [ 'En progreso', prog, '#ba7517' ], [ 'Cerrado', closed, '#1d9e75' ]].forEach(s => {
    const pct = total ? Math.round(s[1]/total*100) : 0;
    html += `<div class="chart-bar-row"><div class="chart-bar-label">${s[0]}</div><div class="chart-bar-bg"><div class="chart-bar-fill" style="width:${pct}%;background:${s[2]}">${pct}%</div></div><div class="chart-bar-count">${s[1]}</div></div>`;
  });
  html += '</div></div><div class="report-section"><h3>Por severidad / prioridad</h3><div class="chart-bar-wrap">';
  [[ 'Alta', high, '#a32d2d' ], [ 'Media', med, '#ba7517' ], [ 'Baja', low, '#1d9e75' ]].forEach(s => {
    const pct = total ? Math.round(s[1]/total*100) : 0;
    html += `<div class="chart-bar-row"><div class="chart-bar-label">${s[0]}</div><div class="chart-bar-bg"><div class="chart-bar-fill" style="width:${pct}%;background:${s[2]}">${pct}%</div></div><div class="chart-bar-count">${s[1]}</div></div>`;
  });
  html += '</div></div><div class="report-section"><h3>Por categoria</h3><div class="chart-bar-wrap">';
  Object.keys(cats).sort((a,b)=>cats[b]-cats[a]).forEach(k => {
    const pct = total ? Math.round(cats[k]/total*100) : 0;
    const col = catColors[ci % catColors.length]; ci++;
    html += `<div class="chart-bar-row"><div class="chart-bar-label">${esc(k)}</div><div class="chart-bar-bg"><div class="chart-bar-fill" style="width:${pct}%;background:${col}">${pct}%</div></div><div class="chart-bar-count">${cats[k]}</div></div>`;
  });
  html += '</div></div><div class="report-section"><h3>Detalle de tickets</h3>';
  if (tickets.length) {
    html += '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Titulo</th><th>Categoria</th><th>Prioridad</th><th>Estado</th><th>Solicitante</th><th>Creado</th></tr></thead><tbody>';
    tickets.forEach(t => {
      html += `<tr><td style="font-family:monospace">${esc(t.id)}</td><td>${esc(t.title)}</td><td>${esc(t.category)}</td>`;
      html += `<td><span class="badge badge-${t.priority === 'Alta' ? 'high' : t.priority === 'Media' ? 'medium' : 'low'}">${esc(t.priority)}</span></td>`;
      html += `<td><span class="badge badge-${t.status === 'Abierto' ? 'open' : t.status === 'En progreso' ? 'progress' : 'closed'}">${esc(t.status)}</span></td>`;
      html += `<td>${esc(t.user_name)}</td><td>${esc(t.created)}</td></tr>`;
    });
    html += '</tbody></table></div>';
  } else {
    html += '<div class="empty">No hay tickets con los filtros seleccionados.</div>';
  }
  html += '</div>';
  return html;
}

async function exportCSV() {
  const desde = document.getElementById('rf-desde')?.value || '';
  const hasta = document.getElementById('rf-hasta')?.value || '';
  const status = document.getElementById('rf-status')?.value || '';
  const priority = document.getElementById('rf-priority')?.value || '';
  const category = document.getElementById('rf-cat')?.value || '';
  try {
    const tickets = await apiCall('POST', '/api/reports/filter', { desde, hasta, status, priority, category });
    let csv = 'ID,Titulo,Categoria,Prioridad,Estado,Solicitante,Correo,Tecnico,Creado,Actualizado\n';
    tickets.forEach(t => {
      const row = [t.id, t.title, t.category, t.priority, t.status, t.user_name, t.user_email, t.tecnico || '', t.created, t.updated].map(v => {
        v = String(v == null ? '' : v);
        return `"${v.replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;
      }).join(',');
      csv += row + '\n';
    });
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FSATDesk_Reporte_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Reporte CSV exportado correctamente');
  } catch (err) {
    showToast(err.message);
  }
}

async function exportPDF() {
  const desde = document.getElementById('rf-desde')?.value || '';
  const hasta = document.getElementById('rf-hasta')?.value || '';
  const status = document.getElementById('rf-status')?.value || '';
  const priority = document.getElementById('rf-priority')?.value || '';
  const category = document.getElementById('rf-cat')?.value || '';
  try {
    const tickets = await apiCall('POST', '/api/reports/filter', { desde, hasta, status, priority, category });
    const total = tickets.length;
    const open = tickets.filter(t => t.status === 'Abierto').length;
    const prog = tickets.filter(t => t.status === 'En progreso').length;
    const closed = tickets.filter(t => t.status === 'Cerrado').length;
    const high = tickets.filter(t => t.priority === 'Alta').length;
    const med = tickets.filter(t => t.priority === 'Media').length;
    const low = tickets.filter(t => t.priority === 'Baja').length;
    const cats = {};
    tickets.forEach(t => cats[t.category] = (cats[t.category] || 0) + 1);
    const catColors = ['#1a56db','#1d9e75','#ba7517','#a32d2d','#7c3aed','#0891b2','#059669'];
    function barHTML(label, val, col) {
      const pct = total ? Math.round(val/total*100) : 0;
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:7px"><div style="min-width:130px;text-align:right;font-size:11px;color:#6b7280">${label}</div><div style="flex:1;height:24px;background:#f3f4f6;border-radius:5px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${col};display:flex;align-items:center;padding-left:7px;color:#fff;font-size:11px;font-weight:700;border-radius:5px">${pct}%</div></div><div style="min-width:28px;font-weight:700;font-size:12px;font-family:monospace">${val}</div></div>`;
    }
    let logoSrc = '';
    const logoImg = document.querySelector('img.nav-logo-img');
    if (logoImg && logoImg.src && logoImg.src.startsWith('data:')) logoSrc = logoImg.src;
    let tableRows = '';
    tickets.forEach(t => {
      const priColor = t.priority === 'Alta' ? '#a32d2d' : t.priority === 'Media' ? '#ba7517' : '#1d9e75';
      const stsColor = t.status === 'Abierto' ? '#185fa5' : t.status === 'En progreso' ? '#ba7517' : '#1d9e75';
      tableRows += `<tr><td style="font-family:monospace;font-size:10px">${esc(t.id)}</td><td>${esc(t.title)}</td><td>${esc(t.category)}</td><td><span style="background:${priColor};color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600">${esc(t.priority)}</span></td><td><span style="background:${stsColor};color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600">${esc(t.status)}</span></td><td>${esc(t.user_name)}</td><td>${esc(t.tecnico||'---')}</td><td>${esc(t.created)}</td></tr>`;
    });
    let catBars = '';
    let ci = 0;
    Object.keys(cats).sort((a,b)=>cats[b]-cats[a]).forEach(k => {
      catBars += barHTML(k, cats[k], catColors[ci % catColors.length]);
      ci++;
    });
    const win = window.open('', '_blank');
    if (!win) { showToast('Permite ventanas emergentes para exportar PDF'); return; }
    const genDate = new Date().toLocaleDateString('es-DO', { year:'numeric', month:'long', day:'numeric' });
    const genTime = new Date().toLocaleTimeString('es-DO', { hour:'2-digit', minute:'2-digit' });
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Reporte FSATDesk - ${genDate}</title><style>
      *{box-sizing:border-box;margin:0;padding:0} body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111827;background:#fff;padding:32px}
      .header{display:flex;align-items:center;justify-content:space-between;padding-bottom:18px;border-bottom:3px solid #1a56db;margin-bottom:24px}
      .header-left{display:flex;align-items:center;gap:16px} .header-left img{height:64px;width:auto}
      .brand h1{font-size:22px;font-weight:700} .brand h1 span{color:#1a56db} .brand p{font-size:11px;color:#6b7280}
      .header-right{text-align:right;font-size:11px;color:#6b7280} .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
      .sc{background:#f3f4f6;border-radius:8px;padding:14px;text-align:center} .sc .v{font-size:28px;font-weight:700;font-family:monospace}
      .sc .l{font-size:10px;color:#6b7280;text-transform:uppercase} .cb{color:#1a56db} .cg{color:#1d9e75} .ca{color:#ba7517} .cr{color:#a32d2d}
      .section{margin-bottom:24px} .section h2{font-size:14px;font-weight:700;color:#1a56db;border-bottom:2px solid #e8f0fe;padding-bottom:6px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;font-size:11px} th{background:#1a56db;color:#fff;padding:8px 10px;text-align:left;font-size:10px}
      td{padding:8px 10px;border-bottom:1px solid #e5e7eb} .footer{margin-top:32px;padding-top:14px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af}
      @media print{body{padding:16px}@page{margin:1.5cm}}
    </style></head><body>`);
    win.document.write(`<div class="header"><div class="header-left">${logoSrc ? `<img src="${logoSrc}" alt="FSAT Systems"/>` : ''}<div class="brand"><h1>FSAT<span>Desk</span></h1><p>Sistema de Tickets de Soporte Tecnico</p></div></div><div class="header-right"><strong>Reporte de Tickets</strong><br>Periodo: ${desde || '---'} al ${hasta || '---'}<br>Generado: ${genDate} ${genTime}<br>Usuario: ${currentUser ? currentUser.name : '---'}</div></div>`);
    win.document.write(`<div class="stats"><div class="sc"><div class="v cb">${total}</div><div class="l">Total tickets</div></div><div class="sc"><div class="v ca">${open}</div><div class="l">Abiertos</div></div><div class="sc"><div class="v cg">${closed}</div><div class="l">Cerrados</div></div><div class="sc"><div class="v cr">${high}</div><div class="l">Alta prioridad</div></div></div>`);
    win.document.write(`<div class="section"><h2>Por estado</h2>${barHTML('Abierto', open, '#185fa5')}${barHTML('En progreso', prog, '#ba7517')}${barHTML('Cerrado', closed, '#1d9e75')}</div>`);
    win.document.write(`<div class="section"><h2>Por severidad / prioridad</h2>${barHTML('Alta', high, '#a32d2d')}${barHTML('Media', med, '#ba7517')}${barHTML('Baja', low, '#1d9e75')}</div>`);
    if (catBars) win.document.write(`<div class="section"><h2>Por categoria</h2>${catBars}</div>`);
    win.document.write(`<div class="section"><h2>Detalle de tickets (${total})</h2><table><thead><tr><th>ID</th><th>Titulo</th><th>Categoria</th><th>Prioridad</th><th>Estado</th><th>Solicitante</th><th>Tecnico</th><th>Creado</th></tr></thead><tbody>${tableRows}</tbody></table></div>`);
    win.document.write(`<div class="footer"><span>FSATDesk — FSAT Systems © ${new Date().getFullYear()}</span><span>Reporte generado el ${genDate} a las ${genTime}</span></div>`);
    win.document.close();
    setTimeout(() => win.print(), 800);
    showToast('Reporte PDF listo para imprimir / guardar');
  } catch (err) {
    showToast(err.message);
  }
}

// ==================== AUTO REFRESH ====================
function startAutoRefresh() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  if (refreshTimerInterval) clearInterval(refreshTimerInterval);
  if (currentUser.role !== 'admin' && currentUser.role !== 'tecnico') return;
  refreshCountdown = 30;
  updateRefreshUI();
  const ind = document.getElementById('refresh-indicator');
  if (ind) ind.classList.add('visible');
  refreshTimerInterval = setInterval(() => {
    refreshCountdown--;
    updateRefreshUI();
    if (refreshCountdown <= 0) {
      refreshCountdown = 30;
      doRefresh();
    }
  }, 1000);
  autoRefreshInterval = setInterval(() => { /* actual refresh done in timer */ }, 30000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  if (refreshTimerInterval) clearInterval(refreshTimerInterval);
  autoRefreshInterval = null;
  refreshTimerInterval = null;
  const ind = document.getElementById('refresh-indicator');
  if (ind) ind.classList.remove('visible');
}

function resetRefreshCountdown() {
  if (refreshTimerInterval) refreshCountdown = 30;
  updateRefreshUI();
}

function updateRefreshUI() {
  const lbl = document.getElementById('refresh-label');
  const arc = document.getElementById('refresh-arc');
  if (!lbl || !arc) return;
  lbl.textContent = refreshCountdown + 's';
  const pct = refreshCountdown / 30;
  arc.style.strokeDashoffset = 40 - (pct * 40);
  arc.className = 'arc' + (refreshCountdown <= 5 ? ' now' : refreshCountdown <= 10 ? ' urgent' : '');
}

async function doRefresh() {
  if (!currentUser) return;
  if (currentUser.role !== 'admin' && currentUser.role !== 'tecnico') return;
  await loadTickets();
  if (currentUser.role === 'admin') await loadUsers();
  const safeViews = ['dash', 'tickets'];
  if (safeViews.includes(currentView)) {
    const mc = document.getElementById('main-content');
    if (currentView === 'dash') mc.innerHTML = renderDash();
    if (currentView === 'tickets') mc.innerHTML = renderTickets();
    showToast('Lista actualizada automaticamente');
  }
}

// ==================== NOTIFICATION POLLING ====================
function startNotifPolling() {
  if (notifPollInterval) clearInterval(notifPollInterval);
  if (currentUser.role !== 'admin' && currentUser.role !== 'tecnico') return;
  lastNotifCheck = Date.now();
  notifPollInterval = setInterval(async () => {
    if (!currentUser) return;
    try {
      const tickets = await apiCall('GET', '/api/tickets');
      const newTickets = tickets.filter(t => {
        const created = new Date(t.created).getTime();
        return created > lastNotifCheck && t.user_id !== currentUser.id;
      });
      if (newTickets.length) {
        newTickets.forEach(t => showTicketPopup(t));
      }
      lastNotifCheck = Date.now();
    } catch (e) { /* ignore */ }
  }, 3000);
}

function stopNotifPolling() {
  if (notifPollInterval) clearInterval(notifPollInterval);
  notifPollInterval = null;
}

function showTicketPopup(tk) {
  const priClass = tk.priority === 'Alta' ? 'notif-alta' : tk.priority === 'Media' ? 'notif-media' : 'notif-baja';
  const iconClass = tk.priority === 'Alta' ? 'alta' : tk.priority === 'Media' ? 'media' : 'baja';
  const chipClass = tk.priority === 'Alta' ? 'high' : tk.priority === 'Media' ? 'med' : 'low';
  const uid = 'notif-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const el = document.createElement('div');
  el.className = `notif-popup ${priClass}`;
  el.id = uid;
  const sUid = safeId(uid) || 'n';
  const sTkId = safeId(tk.id) || '';
  el.innerHTML = `
    <div class="notif-header">
      <div class="notif-icon ${iconClass}"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg></div>
      <div class="notif-meta"><div class="notif-label">📦 Nuevo ticket recibido</div><div class="notif-title" title="${esc(tk.title)}">${esc(tk.title)}</div></div>
      <button class="notif-close" onclick="closeNotif('${sUid}')">×</button>
    </div>
    <div class="notif-body">
      <div class="notif-row"><span class="notif-chip ${chipClass}">${esc(tk.priority)} prioridad</span><span class="notif-chip">${esc(tk.category)}</span><span class="notif-chip">${esc(tk.id)}</span></div>
      <div class="notif-user">👤 ${esc(tk.user_name)}${tk.location ? ' • ' + esc(tk.location) : ''}</div>
    </div>
    <div class="notif-actions"><button class="notif-btn-ver" onclick="verTicketDesdeNotif('${sTkId}','${sUid}')">Ver ticket</button><button class="notif-btn-dis" onclick="closeNotif('${sUid}')">Descartar</button></div>
    <div class="notif-progress"><div class="notif-progress-bar"></div></div>`;
  const container = document.getElementById('notif-container');
  if (container) container.appendChild(el);
  setTimeout(() => closeNotif(uid), 8000);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
  } catch(e) {}
}

function closeNotif(uid) {
  const el = document.getElementById(uid);
  if (!el) return;
  el.classList.add('notif-hiding');
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
}

function verTicketDesdeNotif(tkId, uid) {
  closeNotif(uid);
  if (!safeId(tkId)) return;
  viewingTicketId = tkId;
  currentView = 'ticket-detail';
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  const navEl = document.getElementById('nav-tickets');
  if (navEl) navEl.classList.add('active');
  const mc = document.getElementById('main-content');
  if (mc) renderTicketDetail(tkId).then(html => mc.innerHTML = html);
}

// ==================== PASSWORD STRENGTH (frontend only) ====================
function evalPassStrength() {
  const p = document.getElementById('chpass-new')?.value || '';
  const fill = document.getElementById('pwd-strength-fill');
  const lbl = document.getElementById('pwd-strength-label');
  if (!p) { if (fill) fill.style.width = '0%'; if (lbl) lbl.textContent = ''; return; }
  let score = 0;
  if (p.length >= 8) score++;
  if (/[A-Z]/.test(p)) score++;
  if (/[a-z]/.test(p)) score++;
  if (/[0-9]/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  const pcts = ['5%','25%','50%','75%','90%','100%'];
  const cols = ['#ef4444','#ef4444','#f97316','#eab308','#84cc16','#22c55e'];
  if (fill) { fill.style.width = pcts[score]; fill.style.background = cols[score]; }
  if (lbl) {
    if (score === 5) lbl.textContent = 'Contraseña segura ✓';
    else {
      const errs = [];
      if (p.length < 8) errs.push('Mínimo 8 caracteres');
      if (!/[A-Z]/.test(p)) errs.push('Mayúscula');
      if (!/[a-z]/.test(p)) errs.push('Minúscula');
      if (!/[0-9]/.test(p)) errs.push('Número');
      if (!/[^A-Za-z0-9]/.test(p)) errs.push('Símbolo');
      lbl.textContent = 'Falta: ' + errs.join(' · ');
    }
  }
}

// ==================== INITIALIZATION ====================
(async function init() {
  // Restore session if any
  try {
    const sessionData = await apiCall('GET', '/api/auth/session');
    if (sessionData.user) {
      currentUser = sessionData.user;
      await afterLogin();
    } else {
      showScreen('login');
    }
  } catch (err) {
    showScreen('login');
  }
})();