import crypto from 'crypto';

/**
 * Generates a secure, non-guessable attendee ticket ID for Hack The Box Chennai.
 * Format: HTB-CHENNAI-<12-character hex> (48 bits of entropy)
 */
export function generateAttendeeToken(): string {
  const randomPart = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `HTB-CHENNAI-${randomPart}`;
}

export function isValidTokenFormat(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  // Matches HTB-CHENNAI-XXXXXX, HTB-CHN-XXXXXX, or legacy formats
  return /^HTB-[A-Z0-9]{3,10}-[A-F0-9]{8,16}$/i.test(token.trim());
}
