/**
 * Mirrors backend/app/obfuscation.py exactly - same XOR+base64 scheme,
 * same key. See that file's docstring for what this is and isn't:
 * it deters casual DevTools Network/WS-frame inspection, it is NOT
 * encryption, and it provides no protection against anyone opening
 * the Console and calling decodePayload() directly (which is exactly
 * what this module does for every legitimate render anyway).
 *
 * GOLDAPP_PAYLOAD_OBFUSCATION_KEY must match the backend's env var
 * exactly - set at build time via Vite's import.meta.env.
 */
const KEY = import.meta.env.VITE_PAYLOAD_OBFUSCATION_KEY || "goldapp-default-key-change-me";

function xorBytes(bytes, keyStr) {
  const keyBytes = new TextEncoder().encode(keyStr);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return out;
}

export function decodePayload(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const decoded = xorBytes(bytes, KEY);
  const json = new TextDecoder().decode(decoded);
  return JSON.parse(json);
}