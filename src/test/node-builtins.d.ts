/**
 * The handful of Node built-ins the verification tests use.
 *
 * Those tests decode Estro's own output with a real decoder, which means reaching outside the
 * browser environment for a moment. Declaring just what they call keeps that possible without
 * adding a dependency for types the application itself never uses.
 */
declare module "node:child_process" {
  export function execFileSync(
    file: string,
    args?: readonly string[],
    options?: { stdio?: string; maxBuffer?: number; encoding?: string },
  ): Buffer;
}

declare module "node:fs" {
  export function writeFileSync(path: string, data: Uint8Array | string): void;
  export function mkdtempSync(prefix: string): string;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

/** Only the shape `execFileSync` returns, so its bytes can be read back. */
interface Buffer extends Uint8Array {
  toString(encoding?: string): string;
}
