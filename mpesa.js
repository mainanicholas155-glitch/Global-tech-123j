// utils/logger.js — Structured logging with Winston
'use strict';

const winston = require('winston');
const path    = require('path');
const fs      = require('fs');

const LOG_DIR = path.join(__dirname, '../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let log = `${timestamp} [${level.toUpperCase()}] ${message}`;
  if (Object.keys(meta).length) log += ` | ${JSON.stringify(meta)}`;
  if (stack) log += `\n${stack}`;
  return log;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    // Console (dev friendly)
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat)
    }),
    // All logs
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'app.log'),
      maxsize: 5 * 1024 * 1024,  // 5MB
      maxFiles: 5
    }),
    // Error-only log
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5
    }),
    // Payment-specific log
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'payments.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10
    })
  ]
});

module.exports = logger;
