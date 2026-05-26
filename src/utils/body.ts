import type { HttpData } from "../Http.types";

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
export function prepareBody(data: HttpData | undefined): BodyResult {
  if (data === undefined) {
    return { body: undefined, contentType: undefined };
  }

  if (typeof data === "string") {
    return { body: data, contentType: undefined };
  }

  // FormData or HTMLFormElement (runtime environments may have HTMLFormElement)
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
 * Parse a Response body to a plain value.
 * Returns JSON when Content-Type is application/json, otherwise raw text.
 * Never throws — returns null on parse failure.
 */
export async function parseBody(response: Response): Promise<unknown> {
  const ct = response.headers.get("content-type") ?? "";

  try {
    if (ct.includes("application/json")) {
      return await response.clone().json();
    }
    return await response.clone().text();
  } catch {
    return null;
  }
}
