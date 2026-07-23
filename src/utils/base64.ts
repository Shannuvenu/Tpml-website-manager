/**
 * GitHub's Contents API stores file bodies as base64. `btoa`/`atob` only
 * handle Latin1 correctly, so any non-ASCII character (emoji, accented
 * letters, non-Latin scripts) would silently corrupt the file. These
 * helpers route through TextEncoder/TextDecoder so UTF-8 content survives
 * the round trip intact.
 */

export function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  const chunkSize = 0x8000; // avoid call-stack blowups on large files
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToUtf8(base64: string): string {
  // GitHub returns base64 with embedded newlines every 60 chars — strip them.
  const cleaned = base64.replace(/\n/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
