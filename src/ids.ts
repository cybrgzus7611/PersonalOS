/** ULIDs: 48-bit time + 80-bit randomness, Crockford base32, monotonic within one millisecond. */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = -1;
let lastRandom: number[] = [];

function incrementBase32(digits: number[]): number[] {
  const next = digits.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i] < 31) {
      next[i] += 1;
      return next;
    }
    next[i] = 0;
  }
  throw new Error("ULID random component overflowed within one millisecond");
}

export function ulid(now: number = Date.now()): string {
  let random: number[];
  if (now <= lastTime) {
    now = lastTime;
    random = incrementBase32(lastRandom);
  } else {
    random = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b % 32);
  }
  lastTime = now;
  lastRandom = random;
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ENCODING.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  return time + random.map((d) => ENCODING.charAt(d)).join("");
}
