// Pure, store-scoped projection for the Kitchen Dish Aggregated Timeline.
// No database writes. Tickets and DAG must share the same canonical orders.
export function buildKitchenDag(orders, { storeId, now = Date.now(), preparationKey } = {}) {
  if (!storeId || typeof storeId !== 'string') throw new Error('storeId required');
  const groups = new Map();
  for (const order of orders || []) {
    if (order.store_id !== storeId || order.status === 'cancelled' || order.kitchen_completed_at) continue;
    for (const item of order.items || []) {
      if (item.is_done || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) continue;
      // Preserve modifier and instruction differences until a verified kitchen recipe mapping exists.
      const mods = (item.modifiers || []).map(m => String(m.option_id || m.name || '')).sort();
      const recipe = preparationKey ? preparationKey(item, order) : String(item.menu_id || item.id);
      const variant = JSON.stringify([mods, String(item.note || '')]);
      const key = JSON.stringify([storeId, recipe, variant]);
      if (!groups.has(key)) groups.set(key, {
        key, store_id: storeId, kitchen_dish_id: recipe, name: item.name,
        variant, quantity: 0, orders: [], earliest_deadline_at: null
      });
      const group = groups.get(key);
      const deadline = order.platform_deadline_at || null;
      const ms = deadline ? Date.parse(deadline) : NaN;
      const validDeadline = Number.isFinite(ms) ? new Date(ms).toISOString() : null;
      group.quantity += Number(item.quantity);
      group.orders.push({
        order_id: order.id, order_item_id: item.id, quantity: Number(item.quantity),
        source: order.source, platform: order.platform || null,
        external_order_id: order.external_order_id || null,
        deadline_at: validDeadline, received_at: order.created_at,
        is_done: Boolean(item.is_done)
      });
      if (validDeadline && (!group.earliest_deadline_at || validDeadline < group.earliest_deadline_at))
        group.earliest_deadline_at = validDeadline;
    }
  }
  return [...groups.values()].map(g => ({
    ...g,
    orders: g.orders.sort((a,b) => (a.deadline_at || '9999').localeCompare(b.deadline_at || '9999') || String(a.received_at || '').localeCompare(String(b.received_at || ''))),
    overdue: g.earliest_deadline_at !== null && Date.parse(g.earliest_deadline_at) < now
  })).sort((a,b) => (a.earliest_deadline_at || '9999').localeCompare(b.earliest_deadline_at || '9999') || a.name.localeCompare(b.name));
}
