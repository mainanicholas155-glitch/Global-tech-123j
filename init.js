// controllers/authController.js
'use strict';

const { v4: uuidv4 } = require('uuid');
const bcrypt  = require('bcryptjs');
const db      = require('../db/database');
const { signToken } = require('../middleware/auth');
const logger  = require('../utils/logger');

/**
 * POST /api/auth/register
 */
async function register(req, res) {
  const { fullName, email, password, phone, country, language1, language2 } = req.body;

  // Check email uniqueness
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = uuidv4();

  db.prepare(`
    INSERT INTO users (id, full_name, email, password_hash, phone, country, language_1, language_2)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, fullName, email, passwordHash, phone, country, language1, language2);

  const token = signToken({ id: userId, email, role: 'user' });

  logger.info('New user registered', { userId, email, country });

  return res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    token,
    user: { id: userId, fullName, email, phone, country, language1, language2, paymentStatus: 'pending' }
  });
}

/**
 * POST /api/auth/login
 */
async function login(req, res) {
  const { email, password } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  const token = signToken({ id: user.id, email: user.email, role: 'user' });

  return res.json({
    success: true,
    token,
    user: {
      id:             user.id,
      fullName:       user.full_name,
      email:          user.email,
      phone:          user.phone,
      country:        user.country,
      language1:      user.language_1,
      language2:      user.language_2,
      paymentStatus:  user.payment_status,
      trainingStatus: user.training_status,
      accountStatus:  user.account_status
    }
  });
}

/**
 * POST /api/admin/login
 */
async function adminLogin(req, res) {
  const { email, password } = req.body;

  const admin = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  }

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  }

  const token = signToken({ id: admin.id, email: admin.email, role: 'admin' });

  logger.info('Admin login', { adminId: admin.id, email });

  return res.json({ success: true, token, admin: { id: admin.id, email: admin.email } });
}

/**
 * GET /api/admin/users
 */
function adminGetUsers(req, res) {
  const { page = 1, limit = 50, status } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = `
    SELECT id, full_name, email, phone, country, language_1, language_2,
           payment_status, training_status, account_status, created_at
    FROM users
  `;
  const params = [];
  if (status) { query += ' WHERE account_status = ?'; params.push(status); }
  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), offset);

  const users = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN account_status='active'    THEN 1 END) AS active,
      COUNT(CASE WHEN account_status='inactive'  THEN 1 END) AS inactive,
      COUNT(CASE WHEN account_status='suspended' THEN 1 END) AS suspended,
      COUNT(CASE WHEN training_status='completed' THEN 1 END) AS trained
    FROM users
  `).get();

  return res.json({ success: true, users, total, stats });
}

/**
 * PATCH /api/admin/users/:id/status
 */
function adminUpdateUserStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  const allowed = ['active', 'suspended', 'inactive'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }

  db.prepare('UPDATE users SET account_status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
  logger.info('Admin updated user status', { adminId: req.user.id, targetUser: id, status });
  return res.json({ success: true, message: `User status updated to ${status}` });
}

module.exports = { register, login, adminLogin, adminGetUsers, adminUpdateUserStatus };
