import crypto from 'crypto';

import { CapsulePiiFlags } from './meta';

const RAW_KEY = process.env.CAPSULE_META_ENCRYPTION_KEY ?? process.env.CAPSULE_ENCRYPTION_KEY ?? '';
let encryptionKey: Buffer | null = null;
let encryptionErrorLogged = false;

if (RAW_KEY) {
  try {
    const candidate = Buffer.from(RAW_KEY, RAW_KEY.length === 32 ? 'utf8' : 'base64');
    if (candidate.length !== 32) {
      throw new Error('Encryption key must resolve to 32 bytes for AES-256-GCM');
    }
    encryptionKey = candidate;
  } catch (error) {
    encryptionKey = null;
    if (!encryptionErrorLogged) {
      encryptionErrorLogged = true;
      console.error('[Capsule] Failed to initialise metadata encryption:', error);
    }
  }
}

export type EncryptedPayload = {
  version: 1;
  iv: string;
  tag: string;
  data: string;
};

function encodePayload(payload: EncryptedPayload): string {
  return JSON.stringify(payload);
}

function decodePayload(serialised: string): EncryptedPayload | null {
  try {
    const parsed = JSON.parse(serialised);
    if (
      parsed &&
      parsed.version === 1 &&
      typeof parsed.iv === 'string' &&
      typeof parsed.tag === 'string' &&
      typeof parsed.data === 'string'
    ) {
      return parsed as EncryptedPayload;
    }
  } catch (error) {
    if (!encryptionErrorLogged) {
      encryptionErrorLogged = true;
      console.error('[Capsule] Failed to parse encrypted payload:', error);
    }
  }
  return null;
}

export function isEncryptionEnabled(): boolean {
  return Boolean(encryptionKey);
}

export function encryptPiiFlags(value?: CapsulePiiFlags | null): { cipher?: string } {
  if (!encryptionKey || !value || Object.keys(value).length === 0) {
    return {};
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const plaintext = JSON.stringify(value);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    cipher: encodePayload({
      version: 1,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64')
    })
  };
}

export function decryptPiiFlags(cipher?: string | null): CapsulePiiFlags | undefined {
  if (!encryptionKey || !cipher) {
    return undefined;
  }

  const payload = decodePayload(cipher);
  if (!payload) {
    return undefined;
  }

  try {
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const encrypted = Buffer.from(payload.data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const json = decrypted.toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') {
      return parsed as CapsulePiiFlags;
    }
  } catch (error) {
    if (!encryptionErrorLogged) {
      encryptionErrorLogged = true;
      console.error('[Capsule] Failed to decrypt piiFlags payload:', error);
    }
  }
  return undefined;
}
