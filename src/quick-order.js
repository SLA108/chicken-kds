// Validation shared by POS and Kitchen Quick Order endpoints.
// Platform deadlines are immutable external commitments; timeline shifts must be stored separately.
export const QUICK_ORDER_PLATFORMS = Object.freeze(['wolt','uber_eats','pyszne','glovo','bolt_food','other']);
export function validateQuickOrder(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid Quick Order');
  const platform = String(input.platform || '').trim().toLowerCase();
  if (!QUICK_ORDER_PLATFORMS.includes(platform)) throw Error('Choose a delivery platform');
  const externalOrderId = String(input.external_order_id || '').trim();
  if (!externalOrderId || externalOrderId.length > 100) throw Error('External order ID required (max 100 characters)');
  const deadline = input.ready_by;
  if (typeof deadline !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(deadline)) throw Error('Ready By must include a timezone');
  const deadlineMs = Date.parse(deadline);
  if (!Number.isFinite(deadlineMs) || deadlineMs <= now || deadlineMs > now + 48 * 60 * 60 * 1000) throw Error('Ready By must be within the next 48 hours');
  if (typeof input.client_key !== 'string' || input.client_key.length < 16 || input.client_key.length > 128) throw Error('Invalid client key');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) throw Error('Quick Order requires 1–100 items');
  for (const item of input.items) {
    if (!item || typeof item.menu_id !== 'string' || !item.menu_id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw Error('Invalid Quick Order item');
  }
  return {
    platform, external_order_id: externalOrderId, ready_by: new Date(deadlineMs).toISOString(),
    client_key: input.client_key, items: input.items,
    note: String(input.note || '').slice(0,500)
  };
}
