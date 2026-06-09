// controllers/paymentController.js
// ============================================================
//  All M-Pesa STK Push business logic
// ============================================================
'use strict';

const { v4: uuidv4 } = require('uuid');
const db     = require('../db/database');
const mpesa  = require('../utils/mpesa');
const logger = require('../utils/logger');

// ── HELPERS ───────────────────────────────────────────────────

function logEvent(paymentId, eventType, eventData, ip) {
  try {
    db.prepare(`
      INSERT INTO payment_events (payment_id, event_type, event_data, ip_address)
      VALUES (?, ?, ?, ?)
    `).run(paymentId, eventType, JSON.stringify(eventData), ip || 'unknown');
  } catch (e) {
    logger.error('Failed to log payment event', { error: e.message });
  }
}

// ── INITIATE STK PUSH ────────────────────────────────────────

/**
 * POST /api/mpesa/stk-push
 * Body: { phone }
 * Auth: requireAuth
 */
async function initiateStkPush(req, res) {
  const { phone } = req.body;
  const userId    = req.user.id;
  const ip        = req.ip;

  try {
    // 1. Check if user already paid
    const user = db.prepare('SELECT payment_status FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.payment_status === 'paid') {
      return res.status(409).json({
        success: false,
        message: 'Registration fee has already been paid for this account.'
      });
    }

    // 2. Check for pending transaction (prevent duplicate within 2 min)
    const recentPending = db.prepare(`
      SELECT id FROM payments
      WHERE user_id = ? AND payment_status = 'pending'
      AND datetime(created_at) > datetime('now', '-2 minutes')
    `).get(userId);

    if (recentPending) {
      return res.status(429).json({
        success: false,
        message: 'A payment request is already in progress. Please check your phone for the M-Pesa prompt.'
      });
    }

    // 3. Format & validate phone
    let formattedPhone;
    try {
      formattedPhone = mpesa.formatPhone(phone);
    } catch {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number. Use format 07XXXXXXXX or 01XXXXXXXX.'
      });
    }

    // 4. Create pending payment record BEFORE sending to Safaricom
    const paymentId = uuidv4();
    db.prepare(`
      INSERT INTO payments (id, user_id, phone_number, amount, payment_status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(paymentId, userId, formattedPhone, mpesa.AMOUNT);

    logEvent(paymentId, 'STK_INITIATED', { phone: formattedPhone, amount: mpesa.AMOUNT }, ip);

    // 5. Send STK Push
    const stkResult = await mpesa.initiateSTKPush(
      formattedPhone,
      `GCC-${userId.slice(0, 8).toUpperCase()}`,
      'GlobalChat Registration Fee'
    );

    // 6. Update record with Daraja IDs
    db.prepare(`
      UPDATE payments
      SET merchant_request_id = ?, checkout_request_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(stkResult.merchantRequestId, stkResult.checkoutRequestId, paymentId);

    logEvent(paymentId, 'STK_SENT', {
      merchantRequestId: stkResult.merchantRequestId,
      checkoutRequestId: stkResult.checkoutRequestId
    }, ip);

    logger.info('STK Push dispatched', { paymentId, userId, phone: formattedPhone });

    return res.status(200).json({
      success:           true,
      message:           stkResult.customerMessage || 'M-Pesa prompt sent. Enter your PIN to complete payment.',
      paymentId,
      checkoutRequestId: stkResult.checkoutRequestId
    });

  } catch (err) {
    logger.error('STK Push controller error', { error: err.message, userId });
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to initiate payment. Please try again.'
    });
  }
}

// ── SAFARICOM CALLBACK ────────────────────────────────────────

/**
 * POST /api/mpesa/callback
 * Called by Safaricom servers — NO auth required
 */
async function handleCallback(req, res) {
  // Always respond 200 immediately so Safaricom doesn't retry
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    logger.info('M-Pesa callback received', { body: JSON.stringify(req.body) });

    const result = mpesa.processCallback(req.body);

    // Find payment record by checkout ID
    const payment = db.prepare(
      'SELECT * FROM payments WHERE checkout_request_id = ?'
    ).get(result.checkoutRequestId);

    if (!payment) {
      logger.warn('Callback for unknown checkout ID', { checkoutRequestId: result.checkoutRequestId });
      return;
    }

    // Prevent re-processing
    if (payment.payment_status !== 'pending') {
      logger.info('Duplicate callback ignored', { paymentId: payment.id });
      return;
    }

    // Verify amount on success
    if (result.success && result.amount !== mpesa.AMOUNT) {
      logger.warn('Amount mismatch', {
        expected: mpesa.AMOUNT,
        received: result.amount,
        paymentId: payment.id
      });
      // Still mark as failed for safety
      result.success = false;
      result.resultDesc = `Amount mismatch: expected ${mpesa.AMOUNT}, got ${result.amount}`;
    }

    const newStatus = result.success ? 'success' : 'failed';

    // Update payment record
    db.prepare(`
      UPDATE payments SET
        payment_status       = ?,
        mpesa_receipt_number = ?,
        transaction_date     = ?,
        result_code          = ?,
        result_desc          = ?,
        raw_callback         = ?,
        updated_at           = datetime('now')
      WHERE id = ?
    `).run(
      newStatus,
      result.mpesaReceiptNumber,
      result.transactionDate,
      result.resultCode,
      result.resultDesc,
      JSON.stringify(req.body),
      payment.id
    );

    logEvent(payment.id, 'CALLBACK_RECEIVED', {
      resultCode:   result.resultCode,
      resultDesc:   result.resultDesc,
      receipt:      result.mpesaReceiptNumber,
      status:       newStatus
    });

    // Activate user account on success
    if (result.success) {
      db.prepare(`
        UPDATE users SET
          payment_status = 'paid',
          account_status = 'active',
          updated_at     = datetime('now')
        WHERE id = ?
      `).run(payment.user_id);

      logEvent(payment.id, 'ACCOUNT_ACTIVATED', { userId: payment.user_id });
      logger.info('Account activated after successful payment', {
        userId:    payment.user_id,
        receipt:   result.mpesaReceiptNumber,
        paymentId: payment.id
      });
    } else {
      logger.info('Payment failed', {
        paymentId:  payment.id,
        resultCode: result.resultCode,
        resultDesc: result.resultDesc
      });
    }

  } catch (err) {
    logger.error('Callback processing error', { error: err.message });
  }
}

// ── POLL PAYMENT STATUS ──────────────────────────────────────

/**
 * GET /api/mpesa/status/:paymentId
 * Frontend polls this every 3s to get real-time payment status
 */
async function getPaymentStatus(req, res) {
  const { paymentId } = req.params;
  const userId = req.user.id;

  const payment = db.prepare(
    'SELECT * FROM payments WHERE id = ? AND user_id = ?'
  ).get(paymentId, userId);

  if (!payment) {
    return res.status(404).json({ success: false, message: 'Payment not found' });
  }

  // If still pending after 90 seconds, query Safaricom directly
  if (payment.payment_status === 'pending' && payment.checkout_request_id) {
    const ageSeconds = (Date.now() - new Date(payment.created_at).getTime()) / 1000;

    if (ageSeconds > 30 && ageSeconds < 120) {
      try {
        const queryResult = await mpesa.querySTKStatus(payment.checkout_request_id);

        if (queryResult.ResultCode === 0) {
          db.prepare(`
            UPDATE payments SET payment_status = 'success', updated_at = datetime('now') WHERE id = ?
          `).run(paymentId);
          db.prepare(`
            UPDATE users SET payment_status = 'paid', account_status = 'active', updated_at = datetime('now') WHERE id = ?
          `).run(userId);
          payment.payment_status = 'success';
        } else if (queryResult.ResultCode !== undefined && queryResult.ResultCode !== 1032) {
          // 1032 = still waiting for user PIN
          db.prepare(`
            UPDATE payments SET payment_status = 'failed', result_code = ?, result_desc = ?, updated_at = datetime('now') WHERE id = ?
          `).run(queryResult.ResultCode, queryResult.ResultDesc, paymentId);
          payment.payment_status = 'failed';
        }
      } catch {
        // Ignore query errors — callback will still arrive
      }
    }
  }

  const user = db.prepare('SELECT payment_status FROM users WHERE id = ?').get(userId);

  return res.json({
    success:         true,
    paymentStatus:   payment.payment_status,
    accountStatus:   user?.payment_status,
    receiptNumber:   payment.mpesa_receipt_number,
    transactionDate: payment.transaction_date,
    amount:          payment.amount,
    message:         statusMessage(payment.payment_status)
  });
}

function statusMessage(status) {
  const map = {
    pending:   'Waiting for M-Pesa confirmation…',
    success:   'Payment confirmed! Your account is now active.',
    failed:    'Payment failed. Please try again.',
    cancelled: 'Payment was cancelled.',
    timeout:   'Payment timed out. Please try again.'
  };
  return map[status] || 'Unknown status';
}

// ── PAYMENT HISTORY (user) ───────────────────────────────────

/**
 * GET /api/mpesa/history
 */
function getPaymentHistory(req, res) {
  const payments = db.prepare(`
    SELECT id, phone_number, amount, mpesa_receipt_number,
           transaction_date, payment_status, created_at
    FROM payments
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(req.user.id);

  return res.json({ success: true, payments });
}

// ── ADMIN: ALL PAYMENTS ───────────────────────────────────────

/**
 * GET /api/admin/payments
 */
function adminGetPayments(req, res) {
  const { page = 1, limit = 50, status } = req.query;
  const offset = (page - 1) * limit;

  let query = `
    SELECT p.*, u.full_name, u.email
    FROM payments p
    JOIN users u ON u.id = p.user_id
  `;
  const params = [];

  if (status) {
    query += ' WHERE p.payment_status = ?';
    params.push(status);
  }

  query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const payments = db.prepare(query).all(...params);
  const stats    = db.prepare(`
    SELECT
      COUNT(*)                                               AS total,
      COUNT(CASE WHEN payment_status='success'  THEN 1 END) AS successful,
      COUNT(CASE WHEN payment_status='failed'   THEN 1 END) AS failed,
      COUNT(CASE WHEN payment_status='pending'  THEN 1 END) AS pending,
      SUM(CASE WHEN payment_status='success' THEN amount ELSE 0 END) AS total_amount
    FROM payments
  `).get();

  return res.json({ success: true, payments, stats });
}

module.exports = {
  initiateStkPush,
  handleCallback,
  getPaymentStatus,
  getPaymentHistory,
  adminGetPayments
};
