const rateMap = new Map<string, { count: number; resetTime: number }>();

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  rateMap.forEach((value, key) => {
    if (now > value.resetTime) {
      rateMap.delete(key);
    }
  });
}, 60000);

export function checkRateLimit(
  identifier: string,
  limit: number = 10,
  windowMs: number = 60000
): boolean {
  const now = Date.now();
  const entry = rateMap.get(identifier);

  if (!entry || now > entry.resetTime) {
    rateMap.set(identifier, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count++;
  return true;
}
