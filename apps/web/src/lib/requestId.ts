/**
 * A v4 UUID for the `requestId` every mutating command carries (the server validates it
 * with z.string().uuid(), so the shape is not optional).
 *
 * This exists because `crypto.randomUUID()` is not available everywhere we run:
 *
 *   - it is a **secure-context** API, so it is undefined over plain http:// on anything
 *     other than localhost - exactly how a phone reaches a dev/LAN build;
 *   - Safari only shipped it in iOS 15.4.
 *
 * Where it is missing, `crypto.randomUUID()` throws a TypeError. Because that call sits
 * inside the argument list of `socket.emit(...)`, the throw takes the whole emit with it:
 * the bet never leaves the device, so no money moves, no result settles, and no server-side
 * limit is ever applied - while the client-side UI happily acts as if the bet was placed.
 * Never call crypto.randomUUID() directly; call this.
 */
export function randomRequestId(): string {
  const webCrypto: Crypto | undefined = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === "function") webCrypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  // Stamp the version (4) and variant (RFC 4122) bits so this passes uuid validation.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}
