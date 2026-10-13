const KNOWN = new Set([
  'Conversation not found',
  'Not a member of this conversation',
  'Can only revoke own messages',
  'Message not found',
  'Message already revoked',
  'Message not in this conversation',
  'clientMsgId required',
  'Guest can only send messages in assigned conversation'
]);

function clientMessage(error) {
  const message = error && error.message;
  return KNOWN.has(message) ? message : 'Request failed';
}

module.exports = { clientMessage };
