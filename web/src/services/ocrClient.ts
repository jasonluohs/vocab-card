import { ApiError, getAccessCode } from './generationClient';

/**
 * OcrClient: photo → proxy → recognized text (PRD §4.4).
 * Images are compressed in the browser before upload and never
 * stored anywhere (IndexedDB or server).
 */

const API_BASE = (import.meta.env.VITE_API_PROXY_URL as string | undefined) ?? '';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Compress before upload: long edge ~2048px, JPEG quality 0.8.
 * Falls back to the original file when compression is impossible,
 * but enforces the size cap (PRD §4.4).
 */
export async function compressImage(file: File): Promise<Blob> {
  try {
    const bitmap = await loadImage(file);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return enforceLimit(file);
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.8),
    );
    if (blob) return blob;
    return enforceLimit(file);
  } catch {
    return enforceLimit(file);
  }
}

function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_load_failed'));
    };
    img.src = url;
  });
}

function enforceLimit(file: Blob): Blob {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError('image_too_large', 413);
  }
  return file;
}

/** Upload the photo and return the recognized text. */
export async function ocrImage(file: File): Promise<string> {
  if (!API_BASE) throw new ApiError('proxy_not_configured', 0);
  const image = await compressImage(file);
  const form = new FormData();
  form.append('image', image, 'photo.jpg');

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/ocr`, {
      method: 'POST',
      headers: {
        'x-access-code': getAccessCodeSafe(),
      },
      body: form,
    });
  } catch {
    throw new ApiError('network_error', 0);
  }
  if (res.status === 401) throw new ApiError('invalid_access_code', 401, true);
  if (res.status === 413) throw new ApiError('image_too_large', 413);
  if (res.status === 429) throw new ApiError('rate_limited', 429);
  if (res.status === 501) throw new ApiError('ocr_not_configured', 501);
  if (!res.ok) throw new ApiError(`server_error_${res.status}`, res.status);

  const data = (await res.json()) as { text?: string };
  if (typeof data.text !== 'string') {
    throw new ApiError('invalid_model_output', 502);
  }
  return data.text;
}

function getAccessCodeSafe(): string {
  try {
    return getAccessCode();
  } catch {
    return '';
  }
}
