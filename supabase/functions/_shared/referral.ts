/** Request boundary shared by the live Edge Function and protocol tests; no runtime/environment secrets. */
export interface ReferralResult { error?: string; [key: string]: unknown }
export interface ReferralServices {
  collect(userId: string): Promise<ReferralResult>;
  claim(userId: string, code: string): Promise<ReferralResult>;
  rate(userId: string): Promise<boolean>;
}
export async function referralRequest(raw: unknown, userId: string | null, services: ReferralServices): Promise<{ status: number; body: ReferralResult }> {
  if (!userId) return { status: 401, body: { error: 'not_signed_in' } };
  const body = raw && typeof raw === 'object' ? raw as { protocol?: unknown; action?: unknown; code?: unknown } : null;
  // Legacy clients cannot handle gem grants or save receipts. Never consume a reward on their behalf.
  if (body?.protocol !== 2) return { status: 409, body: { error: 'update_required' } };
  if (body.action === 'collect') return { status: 200, body: await services.collect(userId) };
  if (body.action !== 'claim') return { status: 400, body: { error: 'bad_request' } };
  if (!(await services.rate(userId))) return { status: 429, body: { error: 'rate_limited' } };
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!/^[A-HJ-NP-Z2-9]{7}$/.test(code)) return { status: 404, body: { error: 'unknown_code' } };
  const result = await services.claim(userId, code);
  return { status: result.error ? result.error === 'unknown_code' ? 404 : 409 : 200, body: result };
}
