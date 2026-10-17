import { toast } from "sonner";
import { ACTION_MS, showError } from "@/lib/notify";
import { api } from "./client";
import { ApiError, toApiError, unwrap } from "./errors";
import type { components } from "./schema";

type DownloadRequest = components["schemas"]["DownloadRequest"];
export type Saved = components["schemas"]["Saved"];

/**
 * Downloads that say where they went. In the desktop app the engine saves each one
 * in the Downloads folder, and a note says so, "Saved to Downloads: ancestree-import-template.csv",
 * with Show in folder. In a browser, or a copy, the browser saves it, as it always has.
 */
async function savedHere(save: () => Promise<Saved>): Promise<Saved | null> {
  try {
    return await save();
  } catch (error) {
    if (error instanceof ApiError && error.code === "browser_saves") return null;
    throw error;
  }
}

/** The note: where it went, and Show in folder; `then` says what more there is to know. */
export function savedNote(saved: Saved, then?: string): void {
  toast.success(`Saved to ${saved.folder}: ${saved.name}`, {
    description: then,
    duration: ACTION_MS,
    action: {
      label: "Show in folder",
      onClick: () => {
        unwrap(api.POST("/api/downloads/show", { body: { name: saved.name } })).catch(showError);
      },
    },
  });
}

/** The browser's own download, from an address. */
export function browserDownload(url: string, name = ""): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * Save a file the engine has or makes, in Downloads with its note; else the browser's download
 * from `url`. Whether the engine saved it: the caller says more only when it didn't.
 */
export async function saveDownload(
  request: DownloadRequest,
  url: string,
  name: string,
  then?: string,
): Promise<boolean> {
  try {
    const saved = await savedHere(() => unwrap(api.POST("/api/downloads", { body: request })));
    if (saved) {
      savedNote(saved, then);
      return true;
    }
  } catch (error) {
    showError(error);
    return true; // said why it couldn't, so nothing more
  }
  browserDownload(url, name);
  return false;
}

/** Save a file drawn in the page, the tree's picture: as `saveDownload`, the blob uploaded. */
export async function saveDrawn(blob: Blob, name: string, then?: string): Promise<boolean> {
  try {
    const saved = await savedHere(async () => {
      // Multipart, as the app's other uploads: openapi-fetch's typed body has no Blob.
      const form = new FormData();
      form.append("file", blob, name);
      form.append("name", name);
      const response = await fetch("/api/downloads/picture", { method: "POST", body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw toApiError(response.status, body);
      return body as Saved;
    });
    if (saved) {
      savedNote(saved, then);
      return true;
    }
  } catch (error) {
    showError(error);
    return true;
  }
  const url = URL.createObjectURL(blob);
  browserDownload(url, name);
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return false;
}
