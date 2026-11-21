/** An API failure with a sentence meant for people, plus the details the app can act on. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined = undefined,
    readonly detail: unknown = undefined,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Field errors from a 422, as "birth_date" or "birth_place.town" -> message. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.detail)) return {};
    const fields: Record<string, string> = {};
    for (const item of this.detail as { loc?: unknown[]; msg?: string }[]) {
      const path = (item.loc ?? []).slice(1).join(".");
      if (path && item.msg) fields[path] = cleanMessage(item.msg);
    }
    return fields;
  }
}

/** What's said when the engine can't be reached: it has stopped, or is starting
 *  again. Never the browser's own words, "Failed to fetch" in Chrome and Edge or "Load failed"
 *  in the Mac's web view, nor a code. */
export const NOT_ANSWERING = "AncesTree's engine isn't answering.";
const ENGINE_FAILED = "Something went wrong in AncesTree's engine.";

// What browsers say of a fetch that never reached anything.
const UNREACHED =
  /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/;

function unreached(error: unknown): boolean {
  return error instanceof TypeError && UNREACHED.test(error.message);
}

function cleanMessage(message: string): string {
  return message.replace(/^Value error, /, "");
}

export function toApiError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null | undefined)?.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail) && "message" in detail) {
    const { message, code } = detail as { message: string; code?: string };
    return new ApiError(message, status, code, detail);
  }
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string } | undefined;
    const message = first?.msg ? cleanMessage(first.msg) : "Something in the form isn't valid.";
    return new ApiError(message, status, "invalid", detail);
  }
  if (typeof detail === "string") return new ApiError(detail, status);
  // Nothing said: words of our own, never a code.
  if (status === 0 || status >= 502) return new ApiError(NOT_ANSWERING, status, "not_answering");
  if (status >= 500) return new ApiError(ENGINE_FAILED, status);
  return new ApiError("That didn't work.", status);
}

/**
 * A fetch of the engine that says in words when it never reached it: an ApiError saying
 * `NOT_ANSWERING`, coded `not_answering`. A fetch stopped on purpose (an `AbortError`) stays as
 * it is. Every call to the engine goes through it, the typed client's included.
 */
export async function reach(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await globalThis.fetch(input, init);
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError(NOT_ANSWERING, 0, "not_answering");
    throw error;
  }
}

/** What went wrong, in words for people: an error's own sentence, or the engine not answering
 *  in place of the browser's words. */
export function inWords(error: unknown): string {
  if (unreached(error)) return NOT_ANSWERING;
  return error instanceof Error && error.message ? error.message : "Something went wrong.";
}

/** Whether doing it again may work: the engine didn't answer, or failed on its own side. A
 *  rule that refused, or a form to put right, won't change by trying again. */
export function canTryAgain(error: unknown): boolean {
  if (unreached(error)) return true;
  return error instanceof ApiError && (error.code === "not_answering" || error.status >= 500);
}

/** openapi-fetch results: the data, or an ApiError thrown for anything that isn't 2xx. */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok) throw toApiError(response.status, error);
  return data as T;
}
