import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Production JWT_SECRET is stable across restarts. Development proofs intentionally
// expire on restart when no secret is configured, requiring another upstream lookup.
const secret = process.env.JWT_SECRET || randomBytes(32).toString('hex');
function payload(ref) {
  return JSON.stringify(Object.fromEntries(Object.keys(ref).filter(k => k !== 'verification_proof').sort().map(k => [k, ref[k]])));
}
export function attestReference(ref) {
  const canonical = { ...ref, verified_at: new Date().toISOString() };
  delete canonical.verification_proof;
  canonical.verification_proof = createHmac('sha256', secret).update(payload(canonical)).digest('hex');
  return canonical;
}
export function hasReferenceProof(ref) {
  if (!ref || typeof ref.verification_proof !== 'string' || !/^[a-f0-9]{64}$/.test(ref.verification_proof)) return false;
  const expected = createHmac('sha256', secret).update(payload(ref)).digest();
  return timingSafeEqual(expected, Buffer.from(ref.verification_proof, 'hex'));
}
