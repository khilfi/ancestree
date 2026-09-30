/**
 * Where the browser finds a file the backend serves: a photo, a story's picture, a download.
 * Components ask here rather than writing "/api/…" themselves, so a view-only copy can
 * hand out the files it carries instead (src/viewer/answers.ts).
 */

type Resolver = (path: string) => string;

let resolve: Resolver = (path) => path;

/** Used by a view-only copy only, before anything is drawn. */
export function setAddresses(resolver: Resolver): void {
  resolve = resolver;
}

export function address(path: string): string {
  return resolve(path);
}

/** A photo circle: 128 pixels for the tree and lists, 512 for the panel. `version` changes with
 *  every new photo, so browsers never show an old one. */
export function avatarAddress(personId: string, size: 128 | 512, version: number): string {
  return address(`/api/persons/${personId}/photo/avatar?size=${size}&v=${version}`);
}

/** The whole photo, upright, for choosing a new crop. */
export function displayPhotoAddress(personId: string, version: number): string {
  return address(`/api/persons/${personId}/photo/display?v=${version}`);
}

/** A picture in someone's story, named as the story names it ("media/…webp"). */
export function storyPictureAddress(personId: string, src: string): string {
  return address(`/api/persons/${personId}/${src}`);
}

/** An export or backup, to download. */
export function exportAddress(name: string): string {
  return address(`/api/exports/${encodeURIComponent(name)}`);
}

/** The import template: empty, or with the fictional test family. */
export function templateAddress(example: boolean): string {
  return address(`/api/imports/template${example ? "?example=true" : ""}`);
}

/** What an import left out or found different. */
export function importReportAddress(id: string): string {
  return address(`/api/imports/${encodeURIComponent(id)}/report`);
}

/** The addresses someone's files are served at, as a copy to edit keeps its files by them
 *  (src/copyedit/book.ts, M20): not resolved, since they're where the copy's own answers look. */
export const personFiles = {
  all: (id: string) => `/api/persons/${id}/`,
  photo: (id: string) => `/api/persons/${id}/photo/`,
  avatar: (id: string, size: number) => `/api/persons/${id}/photo/avatar?size=${size}`,
  display: (id: string) => `/api/persons/${id}/photo/display`,
  picture: (id: string, name: string) => `/api/persons/${id}/media/${name}`,
};
