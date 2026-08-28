/**
 * Server-side secret encryption for managed provider credentials — Batch 4C.
 *
 * NO HOMEMADE CRYPTOGRAPHY. Everything below is AES-256-GCM through the
 * platform's own Web Crypto implementation (`crypto.subtle`), which exists in
 * both the Supabase Edge runtime and Node. This module contributes key
 * management and record framing; it contributes no primitive.
 *
 * THE THREAT THIS ADDRESSES, STATED PLAINLY. An attacker who obtains read
 * access to the database — a leaked backup, an over-broad service credential,
 * a support export — must not obtain the platform's provider API keys. The
 * root key is NOT in the database: it is a deployment secret, held in the edge
 * function's environment, so database access alone yields ciphertext.
 *
 * It does NOT defend against an attacker who holds both the database and the
 * edge environment. Nothing that decrypts inside the edge function can, and
 * pretending otherwise would be the more dangerous claim.
 *
 * FOUR PROPERTIES OF THE RECORD FORMAT, EACH LOAD-BEARING.
 *
 *   `alg` and `v`     Recorded on every record, so a future migration to a
 *                     different scheme reads old records rather than guessing.
 *
 *   `kid`             The root key's identity. A record sealed under a retired
 *                     root key is DETECTED — it fails with a stated reason
 *                     instead of a generic "decryption failed", which is the
 *                     difference between a five-minute diagnosis and an
 *                     afternoon of one.
 *
 *   `iv`              Fresh 96 random bits per record. Never derived, never
 *                     reused: GCM's security collapses under IV reuse.
 *
 *   `aad`             The credential's identity — provider, scope, credential
 *                     id — authenticated but not encrypted. A ciphertext moved
 *                     from one row to another fails to open, so an attacker
 *                     with UPDATE on the table cannot make the OpenAI
 *                     configuration execute with a credential stored under a
 *                     different provider.
 *
 * FAIL CLOSED, ALWAYS. When no root key is configured there is no cipher, and
 * `createSecretCipher` returns one that REFUSES to seal with a precise message.
 * It never falls back to base64, to a hard-coded key, or to storing the value
 * as it arrived. An unencryptable secret is not stored.
 */

import { AIError } from '../../contracts/errors.ts';

/** The sealed record, as it is written to storage. Carries no plaintext. */
export interface SealedSecret {
  readonly v: 1;
  readonly alg: 'AES-256-GCM';
  /** Root key identity, so a key rotation produces a diagnosable failure. */
  readonly kid: string;
  /** Base64 initialisation vector, 12 bytes. Unique per record. */
  readonly iv: string;
  /** Base64 ciphertext with the GCM tag appended, as WebCrypto emits it. */
  readonly ct: string;
}

/**
 * The identity a sealed secret is bound to. Authenticated, not encrypted —
 * changing any of it makes the record fail to open.
 */
export interface SecretBinding {
  readonly providerKey: string;
  readonly scope: string;
  readonly credentialId: string;
}

export interface SecretCipher {
  /** True when a root key is configured and sealing is possible. */
  readonly available: boolean;
  /** Identity of the root key in force, once it has been derived. */
  readonly keyId: string | undefined;
  seal(plaintext: string, binding: SecretBinding): Promise<SealedSecret>;
  open(sealed: SealedSecret, binding: SecretBinding): Promise<string>;
  /**
   * A stable, non-reversible fingerprint of a secret.
   *
   * Keyed with the root key, so the digest of a given API key differs between
   * deployments and cannot be compared against a precomputed table. Truncated,
   * because its only job is "is this the same key I stored before?".
   */
  fingerprint(plaintext: string): Promise<string>;
}

/** The environment variable holding the base64 32-byte root key. */
export const CREDENTIAL_ROOT_KEY_ENV = 'AI_CREDENTIAL_ENCRYPTION_KEY';

const REQUIRED_KEY_BYTES = 32;
const IV_BYTES = 12;
const FINGERPRINT_HEX_CHARS = 16;

function subtle(): SubtleCrypto {
  const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (!webcrypto?.subtle) {
    throw new AIError('INTERNAL_ERROR', 'Secure credential storage is unavailable.', {
      diagnostics: 'this runtime provides no Web Crypto subtle implementation',
    });
  }
  return webcrypto.subtle;
}

/**
 * Byte handling below deals in `ArrayBuffer` rather than `Uint8Array`.
 *
 * Not a style choice. A `Uint8Array` may be backed by a `SharedArrayBuffer`,
 * which the Web Crypto typings correctly refuse as a `BufferSource` — passing
 * one to `subtle.encrypt` would hand a key operation a buffer another thread
 * can mutate underneath it. Materialising an owned `ArrayBuffer` at the
 * boundary makes that impossible rather than merely unlikely.
 */
function owned(source: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(source.byteLength);
  new Uint8Array(buffer).set(source);
  return buffer;
}

function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(out);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function utf8(value: string): ArrayBuffer {
  return owned(new TextEncoder().encode(value));
}

/**
 * The authenticated-but-unencrypted context for one record.
 *
 * The three components are separated by a character none of them may contain
 * (both provider keys and scopes are bounded identifiers, and the credential id
 * is server-minted), so `a b|c` and `a|b c` cannot produce the same AAD — the
 * classic concatenation ambiguity, which here would let two different
 * credentials share one binding.
 */
function additionalData(binding: SecretBinding): ArrayBuffer {
  return utf8(
    `marq.cortex.ai.credential.v1|${binding.providerKey}|${binding.scope}|${binding.credentialId}`,
  );
}

/**
 * Read and validate the root key.
 *
 * A key of the wrong length is REFUSED rather than stretched or padded to fit.
 * Padding a short key to 32 bytes produces something that works, encrypts, and
 * has a fraction of the entropy an operator believes it has.
 */
export function parseRootKey(raw: string | undefined): Uint8Array | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  let bytes: Uint8Array;
  try {
    bytes = fromBase64(trimmed);
  } catch {
    throw new AIError('INTERNAL_ERROR', 'Secure credential storage is misconfigured.', {
      diagnostics: `${CREDENTIAL_ROOT_KEY_ENV} is not valid base64`,
    });
  }
  if (bytes.length !== REQUIRED_KEY_BYTES) {
    throw new AIError('INTERNAL_ERROR', 'Secure credential storage is misconfigured.', {
      diagnostics:
        `${CREDENTIAL_ROOT_KEY_ENV} decodes to ${bytes.length} bytes; ` +
        `AES-256-GCM requires exactly ${REQUIRED_KEY_BYTES}`,
    });
  }
  return bytes;
}

/** The refusal a cipher without a root key raises. Never a silent fallback. */
export function credentialEncryptionUnavailable(): AIError {
  return new AIError(
    'INTERNAL_ERROR',
    'Managed provider credentials cannot be stored: secure credential storage is not configured.',
    {
      diagnostics:
        `${CREDENTIAL_ROOT_KEY_ENV} is not set. A managed credential is accepted only when it ` +
        'can be encrypted at rest; storing it any other way is not offered.',
      retryable: false,
    },
  );
}

/**
 * A cipher that cannot encrypt, for a deployment with no root key.
 *
 * Every call fails with the same stated reason. This is what makes "no
 * encryption available" a REFUSAL rather than a silent downgrade: the
 * administration layer surfaces the error to the operator, and no credential
 * is written.
 */
export function unavailableSecretCipher(): SecretCipher {
  return {
    available: false,
    keyId: undefined,
    seal: () => Promise.reject(credentialEncryptionUnavailable()),
    open: () => Promise.reject(credentialEncryptionUnavailable()),
    fingerprint: () => Promise.reject(credentialEncryptionUnavailable()),
  };
}

export function createSecretCipher(rootKey: Uint8Array | undefined): SecretCipher {
  if (rootKey === undefined) return unavailableSecretCipher();
  if (rootKey.length !== REQUIRED_KEY_BYTES) {
    throw new AIError('INTERNAL_ERROR', 'Secure credential storage is misconfigured.', {
      diagnostics: `root key is ${rootKey.length} bytes, expected ${REQUIRED_KEY_BYTES}`,
    });
  }

  // A copy, so a caller that zeroes or reuses its buffer cannot change the key
  // this cipher uses half-way through the isolate's life.
  const keyMaterial = owned(rootKey);

  let encryptionKey: Promise<CryptoKey> | undefined;
  let macKey: Promise<CryptoKey> | undefined;
  let keyId: string | undefined;

  function aesKey(): Promise<CryptoKey> {
    encryptionKey ??= subtle().importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
    return encryptionKey;
  }

  function hmacKey(): Promise<CryptoKey> {
    macKey ??= subtle().importKey('raw', keyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    return macKey;
  }

  /**
   * The root key's identity — an HMAC over a fixed label rather than a digest
   * of the key itself, so publishing it in every stored record does not publish
   * a value an attacker could test candidate keys against offline any more
   * cheaply than they could test the ciphertext itself.
   */
  async function rootKeyId(): Promise<string> {
    if (keyId !== undefined) return keyId;
    const mac = await subtle().sign('HMAC', await hmacKey(), utf8('marq.cortex.credential.kid'));
    keyId = `k_${toHex(new Uint8Array(mac)).slice(0, 12)}`;
    return keyId;
  }

  // Derived eagerly so `keyId` is readable synchronously by the console read
  // path. A failure here is a misconfiguration and surfaces on the first seal.
  const keyIdReady = rootKeyId().catch(() => undefined);

  return {
    available: true,
    get keyId() {
      return keyId;
    },

    async seal(plaintext, binding) {
      if (typeof plaintext !== 'string' || plaintext.trim() === '') {
        throw new AIError('VALIDATION_FAILED', 'A credential value is required.', {
          fields: ['secret'],
        });
      }
      await keyIdReady;
      const iv = randomBytes(IV_BYTES);
      const ciphertext = await subtle().encrypt(
        {
          name: 'AES-GCM',
          iv: owned(iv),
          additionalData: additionalData(binding),
          tagLength: 128,
        },
        await aesKey(),
        utf8(plaintext),
      );
      return {
        v: 1,
        alg: 'AES-256-GCM',
        kid: await rootKeyId(),
        iv: toBase64(iv),
        ct: toBase64(new Uint8Array(ciphertext)),
      };
    },

    async open(sealed, binding) {
      if (sealed?.alg !== 'AES-256-GCM' || sealed.v !== 1) {
        throw new AIError('INTERNAL_ERROR', 'A stored provider credential cannot be read.', {
          diagnostics:
            `unsupported sealed-secret record: v=${String(sealed?.v)} alg=${String(sealed?.alg)}`,
        });
      }
      const current = await rootKeyId();
      if (sealed.kid !== current) {
        // Named precisely, because the alternative — a bare "decryption
        // failed" — sends an operator looking for corruption when the real
        // answer is that the deployment's root key changed.
        throw new AIError('INTERNAL_ERROR', 'A stored provider credential cannot be read.', {
          diagnostics:
            `sealed under root key ${sealed.kid}, deployment holds ${current}. ` +
            'The credential must be re-entered under the current key.',
          retryable: false,
        });
      }
      let plaintext: ArrayBuffer;
      try {
        plaintext = await subtle().decrypt(
          {
            name: 'AES-GCM',
            iv: owned(fromBase64(sealed.iv)),
            additionalData: additionalData(binding),
            tagLength: 128,
          },
          await aesKey(),
          owned(fromBase64(sealed.ct)),
        );
      } catch {
        // The caught error is deliberately not reported. GCM authentication
        // failures are all the same fact — this record does not belong to this
        // key and this binding — and the underlying message varies by runtime.
        throw new AIError('INTERNAL_ERROR', 'A stored provider credential cannot be read.', {
          diagnostics: 'authenticated decryption failed for the stored credential record',
          retryable: false,
        });
      }
      return new TextDecoder().decode(plaintext);
    },

    async fingerprint(plaintext) {
      const mac = await subtle().sign('HMAC', await hmacKey(), utf8(`fp ${plaintext}`));
      return `fp_${toHex(new Uint8Array(mac)).slice(0, FINGERPRINT_HEX_CHARS)}`;
    },
  };
}

/**
 * The last four characters of a secret, when showing them is safe.
 *
 * Safe means the secret is long enough that four characters are a rounding
 * error against its entropy. A short value returns nothing rather than a
 * meaningful fraction of itself, and the check is on the SECRET's length, not
 * on a vendor prefix — a rule keyed to `sk-` is a rule that stops working the
 * day a vendor changes its format.
 */
export function safeLastFour(plaintext: string): string | undefined {
  const trimmed = plaintext.trim();
  return trimmed.length >= 16 ? trimmed.slice(-4) : undefined;
}
