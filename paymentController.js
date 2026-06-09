// server.js — GlobalChat Connect Backend Server
// ============================================================
'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const logger     = require('./utils/logger');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY HEADERS ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc:    ["'self'", 'fonts.gstatic.com'],
      connectSrc: ["'self'"]
    }
  }
}));

// ── CORS ──────────────────────────────────────────────────────
// In production, replace '*' with your actual frontend domain
app.use(cors({
  origin:      process.env.NODE_ENV === 'production'
    ? process.env.BASE_URL
    : '*',
  credentials: true,
  methods:     ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ── BODY PARSING ──────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── LOGGING ───────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: msg => logger.info(msg.trim()) }
}));

// ── GLOBAL RATE LIMIT ────────────────────────────────────────
app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max:      parseInt(process.env.RATE_LIMIT_MAX || '100'),
  standardHeaders: true,
  legacyHeaders:   false
}));

// ── SERVE FRONTEND ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── API ROUTES ────────────────────────────────────────────────
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/mpesa', require('./routes/payment'));

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:      'ok',
    environment: process.env.MPESA_ENVIRONMENT || 'sandbox',
    timestamp:   new Date().toISOString()
  });
});

// ── SPA FALLBACK ─────────────────────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  } else {
    res.status(404).json({ success: false, message: 'Endpoint not found' });
  }
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'An internal error occurred.'
      : err.message
  });
});

// ── START ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 GlobalChat server running on port ${PORT}`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`📱 M-Pesa env: ${process.env.MPESA_ENVIRONMENT || 'sandbox'}`);
  logger.info(`💰 Amount: KES ${process.env.MPESA_AMOUNT || 100}`);
});

module.exports = app;
