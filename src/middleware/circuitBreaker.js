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
  if (!id || !['approve', 'deny'].includes(decision)) {
    throw new Error(`Invalid parameters: id=${id}, decision=${decision}`);
  }

  const approval = pendingApprovals.get(id);
  if (!approval || approval.status !== 'pending') {
    return false;
  }

  try {
    approval.status = decision;
    approval.resolvedAt = Date.now();

    if (decision === 'approve' && typeof approval.onApprove === 'function') {
      approval.onApprove();
    }
    if (decision === 'deny' && typeof approval.onDeny === 'function') {
      approval.onDeny();
    }

    pendingApprovals.delete(id);
    return true;
  } catch (error) {
    // Keep the approval in pending state if callback fails
    throw new Error(`Failed to resolve approval ${id}: ${error.message}`);
  }
}

/**
 * List all pending approvals.
 * @returns {Array}
 */
function listPendingApprovals() {
  return Array.from(pendingApprovals.entries()).map(([id, data]) => ({ id, ...data }));
}

/**
 * Approve a pending request by ID.
 * @param {string} id
 * @returns {boolean} success
 */
function approveRequest(id) {
  return resolveApproval(id, 'approve');
}

/**
 * Deny a pending request by ID.
 * @param {string} id
 * @returns {boolean} success
 */
function denyRequest(id) {
  return resolveApproval(id, 'deny');
}

module.exports = {
  requestApproval,
  resolveApproval,
  approveRequest,
  denyRequest,
  listPendingApprovals,
};
