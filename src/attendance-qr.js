// Shared, versioned 15-second attendance QR protocol. Keep this file identical in POS and Staff.
export const QR_PERIOD_MS = 15000;
export const qrSlot = (utcMillis) => Math.floor(utcMillis / QR_PERIOD_MS);
const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function attendanceQrToken(secret, storeId, slot) {
  if (!secret || !/^[0-9a-f-]{36}$/i.test(storeId) || !Number.isSafeInteger(slot) || slot < 0) throw Error('Invalid attendance QR input');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const payload = `ck-attendance:v1:${storeId.toLowerCase()}:${slot}`;
  const signature = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return `cka1.${storeId.toLowerCase()}.${slot}.${signature}`;
}
export async function verifyAttendanceQr(secret, token, utcMillis = Date.now()) {
  const match = /^cka1\.([0-9a-f-]{36})\.([0-9]+)\.([0-9a-f]{64})$/.exec(token || '');
  if (!match) return null;
  const slot = Number(match[2]);
  // Strict 15-second window; do not accept previous/future slots.
  if (!Number.isSafeInteger(slot) || slot !== qrSlot(utcMillis)) return null;
  const expected = await attendanceQrToken(secret, match[1], slot);
  const a = encoder.encode(expected), b = encoder.encode(token);
  if (a.length !== b.length) return null;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? {storeId:match[1],slot} : null;
}
