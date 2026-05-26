import type { DownloadProgressEvent, ResponseType, UploadProgressEvent } from "../Http.types";

type BodyResult = {
  body: BodyInit | undefined;
  contentType: string | undefined;
};

/**
 * Convert HttpData to a BodyInit suitable for fetch().
 *
 * - FormData / HTMLFormElement → passed through; let the browser set Content-Type
 *   (so the boundary is included automatically — never override it manually).
 * - string → passed through; caller is responsible for Content-Type.
 * - object → JSON.stringify(); Content-Type: application/json.
 */
export function prepareBody(data: unknown): BodyResult {
  if (data === undefined || data === null) {
    return { body: undefined, contentType: undefined };
  }

  if (typeof data === "string") {
    return { body: data, contentType: undefined };
  }

  if (data instanceof FormData) {
    return { body: data, contentType: undefined };
  }

  if (
    typeof HTMLFormElement !== "undefined" &&
    data instanceof HTMLFormElement
  ) {
    return { body: new FormData(data as HTMLFormElement), contentType: undefined };
  }

  // Plain object / array → JSON
  return {
    body: JSON.stringify(data),
    contentType: "application/json",
  };
}

/**
 * Parse a Response body according to the requested responseType.
 * When responseType is omitted, auto-detects from Content-Type.
 * Never throws — returns null on parse failure.
 */
export async function parseBody(
  response: Response,
  responseType?: ResponseType,
): Promise<unknown> {
  try {
    switch (responseType) {
      case "blob":
        return await response.blob();
      case "arrayBuffer":
        return await response.arrayBuffer();
      case "text":
        return await response.text();
      case "json":
        return await response.json();
      default: {
        const ct = response.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          return await response.json();
        }
        if (
          /^(image|video|audio|font)\//i.test(ct) ||
          ct.includes("application/octet-stream") ||
          ct.includes("application/pdf") ||
          ct.includes("application/zip")
        ) {
          return await response.blob();
        }
        return await response.text();
      }
    }
  } catch {
    return null;
  }
}

// ─── Upload progress ─────────────────────────────────────────────────────────

const UPLOAD_CHUNK_SIZE = 65536; // 64 KiB

/**
 * Wrap a request body in a ReadableStream that fires progress events as chunks
 * pass through. Returns the original body unchanged for types that cannot be
 * streamed (FormData, Blob), with no events fired for those types.
 *
 * When the body is wrapped as a ReadableStream, the caller must add
 * `duplex: "half"` to the fetch() options (required by the Fetch spec for
 * half-duplex streaming — Chrome 105+, Node.js 18+, Safari 17.4+).
 */
export function wrapBodyWithProgress(
  body: BodyInit | undefined,
  onProgress: (event: UploadProgressEvent) => void,
): { body: BodyInit | undefined; duplex?: "half" } {
  if (!body || typeof ReadableStream === "undefined") {
    return { body };
  }

  // Convert to Uint8Array for types where we know the full size.
  let bytes: Uint8Array | null = null;

  if (typeof body === "string") {
    bytes = new TextEncoder().encode(body);
  } else if (body instanceof ArrayBuffer) {
    bytes = new Uint8Array(body);
  } else if (ArrayBuffer.isView(body) && !(body instanceof DataView)) {
    bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }

  // FormData / Blob: can't determine size; skip progress (documented limitation).
  if (!bytes) {
    return { body };
  }

  const total = bytes.byteLength;
  let offset = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (offset >= total) {
        controller.close();
        return;
      }
      const end = Math.min(offset + UPLOAD_CHUNK_SIZE, total);
      const chunk = bytes!.subarray(offset, end);
      offset += chunk.byteLength;
      controller.enqueue(chunk);
      onProgress({
        loaded: offset,
        total,
        percent: Math.round((offset / total) * 100),
      });
    },
  });

  return { body: stream, duplex: "half" };
}

/**
 * Read a Response body chunk-by-chunk, firing onProgress after each chunk.
 * Falls back to parseBody when response.body is unavailable.
 */
export async function readBodyWithProgress(
  response: Response,
  onProgress: (event: DownloadProgressEvent) => void,
  responseType?: ResponseType,
): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : null;

  const reader = response.body?.getReader();
  if (!reader) {
    return parseBody(response, responseType);
  }

  const chunks: Uint8Array[] = [];
  let loaded = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      loaded += value.byteLength;

      onProgress({
        loaded,
        total,
        percent: total !== null ? Math.round((loaded / total) * 100) : null,
      });
    }
  } finally {
    reader.releaseLock();
  }

  // Combine all chunks into one buffer
  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  switch (responseType) {
    case "blob":
      return new Blob([combined], {
        type: response.headers.get("content-type") ?? undefined,
      });
    case "arrayBuffer":
      return combined.buffer;
    case "text":
      return new TextDecoder().decode(combined);
    default: {
      const ct = response.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const text = new TextDecoder().decode(combined);
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
      if (
        /^(image|video|audio|font)\//i.test(ct) ||
        ct.includes("application/octet-stream") ||
        ct.includes("application/pdf") ||
        ct.includes("application/zip")
      ) {
        return new Blob([combined], { type: ct || undefined });
      }
      return new TextDecoder().decode(combined);
    }
  }
}
