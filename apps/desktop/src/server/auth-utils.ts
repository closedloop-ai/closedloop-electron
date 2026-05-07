import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time token comparison that avoids timing side-channels.
 * Handles different-length inputs safely (returns false without leaking length).
 */
export function safeEqualToken(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) {
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}
