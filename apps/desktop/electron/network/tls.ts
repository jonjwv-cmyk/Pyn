import { createHash, X509Certificate } from 'node:crypto';
import type { Session } from 'electron';
import type { ProxyConfig } from './proxy';

/**
 * SPKI SHA-256 публичного ключа VPS self-signed сертификата `api.otlhelper.com`.
 * Срок действия до 2036-04-16. Совпадает с pin'ом в OTLHelper2
 * (`PinningConfig.kt::PRIMARY_PIN`).
 *
 * 🔴 CRITICAL: при rotation cert на VPS — обновить эту константу одновременно
 * с обновлением сертификата на сервере, иначе клиенты получат network errors.
 */
export const VPS_SPKI_PIN_SHA256_B64 = 'IvrWDtD7Arjrtu/gI0J68V+RAuuHxU3BHXiet00E5w8=';

/** Основной pinned-хост (action/ws/E2E). WS ходит только сюда. */
export const PINNED_HOST = 'api.otlhelper.com';

/** Хосты, для которых включён pinning в HTTP cert-verify — ВСЕ через слепой VPS-релей (один
 *  self-signed cert, SAN покрывает оба). `api` = E2E action; `cdn` = R2-блобы (аватары/медиа/снимки
 *  базы). Принцип (юзер 2026-06-17): приложение НЕ ходит на Cloudflare напрямую — всё через VPS, даже
 *  в direct-режиме (cdn раньше в direct уходил на CF напрямую — это была единственная утечка). */
export const PINNED_HOSTS = new Set([PINNED_HOST, 'cdn.otlhelper.com']);

/**
 * Включает TLS pinning через `setCertificateVerifyProc`.
 *
 *   • Для PINNED_HOST: проверяем SHA-256 over SubjectPublicKeyInfo (DER),
 *     base64. Если совпадает с VPS_SPKI_PIN_SHA256_B64 — accept (даже
 *     self-signed cert принимается, потому что мы знаем именно его pubkey).
 *   • Если cert MITM'нут Kaspersky / корп AV (issuer содержит "Kaspersky"
 *     или "anti-virus") — fallback на default Chromium verify (-3). Это даёт
 *     корп-юзерам работать через AV-интерсепцию; payload защищён E2E.
 *   • Прочие хосты — default verify (-3).
 *
 * В proxy mode (CONNECT-тоннель к VPS:443) cert presented by VPS сам, не CF.
 * Если корп прокси MITM'ит — fallback на Kaspersky path.
 */
export async function configureTls(ses: Session, _proxy: ProxyConfig | null): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[pyn:tls] installing setCertificateVerifyProc');
  ses.setCertificateVerifyProc((request, callback) => {
    const { hostname, certificate, verificationResult, errorCode } = request;
    // eslint-disable-next-line no-console
    console.log(
      `[pyn:tls] verify ${hostname} chromium=${verificationResult}(${errorCode}) issuer=${certificate.issuerName} subject=${certificate.subjectName}`,
    );

    if (!PINNED_HOSTS.has(hostname)) {
      callback(-3);
      return;
    }

    const spkiHash = computeSpkiSha256Base64(certificate.data);
    // eslint-disable-next-line no-console
    console.log(`[pyn:tls] computed SPKI=${spkiHash} expected=${VPS_SPKI_PIN_SHA256_B64}`);
    if (spkiHash === VPS_SPKI_PIN_SHA256_B64) {
      // eslint-disable-next-line no-console
      console.log(`[pyn:tls] pin verified for ${hostname}`);
      callback(0);
      return;
    }

    if (isCorporateAvCert(certificate.issuerName, certificate.subjectName)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pyn:tls] AV-intercepted cert on ${hostname} (issuer=${certificate.issuerName}), default verify`,
      );
      callback(-3);
      return;
    }

    // eslint-disable-next-line no-console
    console.error(
      `[pyn:tls] SPKI mismatch on ${hostname}: got ${spkiHash}, expected ${VPS_SPKI_PIN_SHA256_B64}`,
    );
    callback(-2);
  });
}

/**
 * SHA-256 over SubjectPublicKeyInfo (DER) → base64. Совпадает с OpenSSL
 * `openssl x509 -in cert.pem -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | base64`.
 *
 * Принимает либо PEM-строку (из Electron `setCertificateVerifyProc`), либо
 * DER-Buffer (из Node `tls.TLSSocket.getPeerCertificate(true).raw`).
 */
export function computeSpkiSha256Base64(certData: string | Buffer): string | null {
  try {
    const cert = new X509Certificate(certData);
    const spkiDer = cert.publicKey.export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(spkiDer).digest('base64');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pyn:tls] SPKI compute failed:', err);
    return null;
  }
}

/** Heuristic: cert intercepted Kaspersky / корп AV. Issuer обычно содержит "kaspersky" / "anti-virus" / "endpoint security". */
export function isCorporateAvCert(issuerName: string | undefined, subjectName: string | undefined): boolean {
  const text = `${issuerName ?? ''} ${subjectName ?? ''}`.toLowerCase();
  return /kaspersky|anti-virus|endpoint security|symantec|eset|bitdefender|trend micro/.test(text);
}
