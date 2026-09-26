import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { checkRateLimit } from './rateLimit';

const PASSWORD_HEADER = 'x-admin-password';
const MAX_FAILURES_PER_MINUTE = 10;

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Constant-time comparison, so a wrong password cannot be discovered one
 * character at a time by measuring how long the check takes.
 */
function safeEqual(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // timingSafeEqual throws on a length mismatch. Compare the expected value
    // against itself so a wrong-length guess still costs a comparison.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * The admin password is read from a request header rather than the query
 * string, because query strings get written to Vercel request logs, kept in
 * browser history, and can leak to third parties through the Referer header.
 */
export function getAdminPassword(
  request: NextRequest,
  formPassword?: string | null
): string | null {
  const header = request.headers.get(PASSWORD_HEADER);
  if (header) return header;
  return formPassword ?? null;
}

/**
 * Returns null when the caller is authorised, otherwise the response to send
 * back. Only *failed* attempts consume the rate-limit budget, so the dashboard
 * (which polls every 15s) is never throttled while password guessing is.
 */
export function requireAdmin(
  request: NextRequest,
  scope: string,
  formPassword?: string | null
): NextResponse | null {
  const password = getAdminPassword(request, formPassword);
  const expected = process.env.ADMIN_PASSWORD;

  if (expected && password && safeEqual(password, expected)) {
    return null;
  }

  if (!checkRateLimit(`auth-${scope}-${clientIp(request)}`, MAX_FAILURES_PER_MINUTE, 60_000)) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: 'Too many failed attempts. Try again in a minute.' },
      { status: 429 }
    );
  }

  return NextResponse.json(
    { error: 'UNAUTHORIZED', message: 'Invalid admin password.' },
    { status: 401 }
  );
}
