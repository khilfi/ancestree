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
  return new ApiError(
    status >= 500 || status === 0
      ? "The AncesTree server didn't answer."
      : `That didn't work (${status}).`,
    status,
  );
}

/** openapi-fetch results: the data, or an ApiError thrown for anything that isn't 2xx. */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok) throw toApiError(response.status, error);
  return data as T;
}
