// circuitBreaker.js
// Human-in-the-loop circuit breaker for sensitive bot actions

const { v4: uuidv4 } = require('uuid');
const pendingApprovals = new Map();

/**
 * Request owner approval for a sensitive action.
 * @param {Object} details - Info about the action (type, user, context, etc)
 * @param {Function} onApprove - Callback if approved
 * @param {Function} onDeny - Callback if denied
 * @returns {string} approvalId
 */
function requestApproval(details, onApprove, onDeny) {
  const id = uuidv4();
  pendingApprovals.set(id, {
    ...details,
    status: 'pending',
    onApprove,
    onDeny,
    requestedAt: Date.now(),
  });
  return id;
}

/**
 * Resolve a pending approval by ID.
 * @param {string} id
 * @param {'approve'|'deny'} decision
 * @returns {boolean} success
 */
function resolveApproval(id, decision) {
  const approval = pendingApprovals.get(id);
  if (!approval || approval.status !== 'pending') return false;
  approval.status = decision;
  approval.resolvedAt = Date.now();
  if (decision === 'approve' && typeof approval.onApprove === 'function') approval.onApprove();
  if (decision === 'deny' && typeof approval.onDeny === 'function') approval.onDeny();
  pendingApprovals.delete(id);
  return true;
}

/**
 * List all pending approvals.
 * @returns {Array}
 */
function listPendingApprovals() {
  return Array.from(pendingApprovals.entries()).map(([id, data]) => ({ id, ...data }));
}

module.exports = {
  requestApproval,
  resolveApproval,
  listPendingApprovals,
};
