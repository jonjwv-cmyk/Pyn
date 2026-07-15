import type { AttachmentWire } from '@pyn/core';
import type { Attachment } from '@pyn/core';

/** MIME из wire + fallback по расширению файла (server иногда шлёт octet-stream). */
export function inferAttachmentMime(fileType: string, filename: string): string {
  const ft = (fileType || '').trim().toLowerCase();
  if (ft && ft !== 'application/octet-stream') return fileType;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const byExt: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    pdf: 'application/pdf',
  };
  return byExt[ext] ?? (ft || 'application/octet-stream');
}

export function wireToAttachment(wire: AttachmentWire): Attachment {
  return {
    id: wire.file_url,
    filename: wire.file_name,
    size: wire.file_size,
    mimeType: inferAttachmentMime(wire.file_type, wire.file_name),
    url: wire.file_url,
    blobKey: wire.blob_key_b64 || undefined,
    blobNonce: wire.blob_nonce_b64 || undefined,
  };
}