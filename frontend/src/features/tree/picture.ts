/*
 * A picture of the tree as it's arranged now: everyone in their place, with the
 * current colours, folded families and rings, and the links drawn as on the canvas. It's
 * drawn as SVG from the canvas's own layout, so it stays sharp at any size and prints well;
 * the PNG is that SVG drawn onto a canvas. Photos and the font go inside the file, so it
 * looks the same wherever it's opened.
 */
import geistUrl from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import { avatarAddress } from "@/api/addresses";
import { initials } from "@/lib/people";
import { RING_LABEL, RING_LINE, ringStroke } from "./colours";
import { type ChildEdgeData, childPath, type SpouseEdgeData } from "./edges";
import { midpoint, NODE_HEIGHT, NODE_WIDTH, PHOTO, rim, SMALL_PHOTO } from "./geometry";
import type { Guide } from "./layouts";
import type { PersonFlowNode } from "./PersonNode";
import type { Point, RingLayout } from "./rings";
import type { TreeEdge } from "./toFlow";

export type TreeSnapshot = {
  nodes: PersonFlowNode[];
  edges: TreeEdge[];
  rings: RingLayout["rings"];
  tray: RingLayout["tray"];
  guides?: Guide[]; // the other layouts' rows and bands
  tinted?: boolean; // coloured by generation: rings and rows take their generation's tint
};

export type Picture = { svg: string; width: number; height: number };

/** How wide a piece of text is in a CSS font, e.g. "500 12px Geist Variable". */
export type Measure = (text: string, font: string) => number;

const FAMILY = "Geist Variable";
const MARGIN = 48;
const LINE = "#a8a29e";
const COLOURS = {
  ring: RING_LINE,
  label: RING_LABEL,
  name: "#292524",
  years: "#78716c",
  border: "#d6d3d1",
  initials: "#57534e",
  initialsBackground: "#f5f5f4",
  marriage: "#78716c",
  pair: "#d6d3d1",
  amber: "#fcd34d",
  amberText: "#92400e",
  amberBackground: "#fffbeb",
};
const DASH = { blood: null, care: "7 5", loose: "2 5" } as const;
const NAME_FONT = `500 12px ${FAMILY}`;

function xml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const n = (value: number) => Math.round(value * 100) / 100;

/** A name on at most two lines of `width`, like the canvas's line clamp: "…" if longer. */
export function wrapName(name: string, width: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of name.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || measure(candidate, NAME_FONT) <= width) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  // More than two lines: the second ends in "…".
  let last = lines.slice(1).join(" ");
  while (last && measure(`${last}…`, NAME_FONT) > width) last = last.slice(0, -1).trimEnd();
  return [lines[0] ?? "", `${last}…`];
}

function unknown(node: PersonFlowNode): boolean {
  return node.type === "unknown";
}

function centre(node: PersonFlowNode): Point {
  const photo = unknown(node) ? SMALL_PHOTO : PHOTO;
  return { x: node.position.x + NODE_WIDTH / 2, y: node.position.y + photo / 2 };
}

function radius(node: PersonFlowNode): number {
  return (unknown(node) ? SMALL_PHOTO : PHOTO) / 2;
}

/** The whole picture as SVG. `photos` are data URLs by person id. */
export function drawTree(
  snapshot: TreeSnapshot,
  {
    photos,
    fontFace,
    measure,
  }: { photos: Map<string, string>; fontFace: string; measure: Measure },
): Picture {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const node of snapshot.nodes) {
    const height = unknown(node) ? SMALL_PHOTO : NODE_HEIGHT;
    boxes.push({
      x1: node.position.x,
      y1: node.position.y,
      x2: node.position.x + NODE_WIDTH + 40, // room for a folded family's badge
      y2: node.position.y + height,
    });
  }
  for (const ring of snapshot.rings) {
    boxes.push({
      x1: ring.x - ring.radius,
      y1: ring.y - ring.radius - 24, // the generation label above
      x2: ring.x + ring.radius,
      y2: ring.y + ring.radius,
    });
  }
  const { tray } = snapshot;
  if (tray) {
    boxes.push({ x1: tray.x, y1: tray.y - 14, x2: tray.x + tray.width, y2: tray.y + tray.height });
  }
  for (const guide of snapshot.guides ?? []) {
    if (guide.kind === "row")
      boxes.push({ x1: guide.x1, y1: guide.y - 24, x2: guide.x2, y2: guide.y });
    else if (guide.kind === "arc") {
      boxes.push({ x1: -guide.radius, y1: -guide.radius, x2: guide.radius, y2: 24 });
    }
  }
  if (boxes.length === 0) boxes.push({ x1: 0, y1: 0, x2: 1, y2: 1 });
  const left = Math.min(...boxes.map((b) => b.x1)) - MARGIN;
  const top = Math.min(...boxes.map((b) => b.y1)) - MARGIN;
  const width = Math.ceil(Math.max(...boxes.map((b) => b.x2)) + MARGIN - left);
  const height = Math.ceil(Math.max(...boxes.map((b) => b.y2)) + MARGIN - top);

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(left)} ${n(top)} ${width} ${height}">`,
    `<style>${fontFace}text{font-family:"${FAMILY}",Arial,sans-serif}</style>`,
    "<defs>",
    `<marker id="arrow" viewBox="-10 -10 20 20" markerWidth="14" markerHeight="14" refX="0" refY="0" orient="auto-start-reverse"><polyline points="-5,-4 0,0 -5,4 -5,-4" fill="${LINE}" stroke="${LINE}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></marker>`,
    "</defs>",
    `<rect x="${n(left)}" y="${n(top)}" width="${width}" height="${height}" fill="#ffffff"/>`,
  ];

  // Rings and their generation labels, behind everyone: a married-in family's too, in the
  // tree's own generations.
  const tinted = snapshot.tinted ?? false;
  for (const ring of snapshot.rings) {
    out.push(
      `<circle cx="${n(ring.x)}" cy="${n(ring.y)}" r="${n(ring.radius)}" fill="none" stroke="${ringStroke(ring.generation, tinted)}" stroke-width="1.5"/>`,
    );
  }
  for (const ring of snapshot.rings) {
    const text = `Generation ${ring.generation}`;
    const textWidth = measure(text, `400 11px ${FAMILY}`);
    const [x, y] = [ring.x, ring.y - ring.radius - 10];
    out.push(
      `<rect x="${n(x - textWidth / 2 - 4)}" y="${n(y - 12)}" width="${n(textWidth + 8)}" height="16" rx="4" fill="#fafaf9" fill-opacity="0.8"/>`,
      `<text x="${n(x)}" y="${n(y)}" text-anchor="middle" font-size="11" fill="${COLOURS.label}">${xml(text)}</text>`,
    );
  }
  // The other layouts' rows and bands, also behind everyone.
  for (const guide of snapshot.guides ?? []) {
    const label = (x: number, y: number, text: string, anchor = "middle") =>
      `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" font-size="11" fill="${COLOURS.label}">${xml(text)}</text>`;
    if (guide.kind === "row") {
      out.push(
        `<line x1="${n(guide.x1)}" y1="${n(guide.y)}" x2="${n(guide.x2)}" y2="${n(guide.y)}" stroke="${ringStroke(guide.generation, tinted)}" stroke-width="1.5"/>`,
        label(guide.x1, guide.y - 10, guide.label, "start"),
      );
    } else if (guide.kind === "arc") {
      const r = n(guide.radius);
      out.push(
        `<path d="M ${-r},0 A ${r} ${r} 0 0 1 ${r},0" fill="none" stroke="${COLOURS.ring}" stroke-width="1.5"/>`,
        label(-guide.radius, 18, guide.label),
      );
    } else if (guide.kind === "line") {
      out.push(
        `<line x1="${n(guide.x1)}" y1="${n(guide.y1)}" x2="${n(guide.x2)}" y2="${n(guide.y2)}" stroke="${COLOURS.ring}" stroke-width="1.5"/>`,
      );
    } else {
      out.push(label(guide.x, guide.y, guide.label));
    }
  }
  if (tray) {
    const label = "Not linked yet";
    const textWidth = measure(label, `500 12px ${FAMILY}`);
    out.push(
      `<rect x="${n(tray.x)}" y="${n(tray.y)}" width="${n(tray.width)}" height="${n(tray.height)}" rx="16" fill="none" stroke="${COLOURS.amber}" stroke-width="2" stroke-dasharray="6 4"/>`,
      `<rect x="${n(tray.x + 16)}" y="${n(tray.y - 10)}" width="${n(textWidth + 16)}" height="20" rx="4" fill="${COLOURS.amberBackground}"/>`,
      `<text x="${n(tray.x + 24)}" y="${n(tray.y + 4)}" font-size="12" font-weight="500" fill="${COLOURS.amberText}">${label}</text>`,
    );
  }

  // Links, as on the canvas (edges.tsx).
  for (const edge of snapshot.edges) {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (!a || !b) continue;
    if (edge.type === "child") {
      const data = edge.data as ChildEdgeData;
      const partner = data.partner ? byId.get(data.partner) : undefined;
      const path = childPath(
        { centre: centre(a), radius: radius(a) },
        partner ? centre(partner) : null,
        { centre: centre(b), radius: radius(b) },
        data,
      );
      const dash = DASH[data.look];
      out.push(
        `<path d="${path}" fill="none" stroke="${LINE}" stroke-width="1.5"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#arrow)"/>`,
      );
      continue;
    }
    const [pa, pb] = [centre(a), centre(b)];
    const start = rim(pa, radius(a), pb);
    const end = rim(pb, radius(b), pa);
    const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const [nx, ny] = [(-(end.y - start.y) / length) * 2.5, ((end.x - start.x) / length) * 2.5];
    const line = (shift: number) =>
      `M ${n(start.x + nx * shift)},${n(start.y + ny * shift)} L ${n(end.x + nx * shift)},${n(end.y + ny * shift)}`;
    const married = edge.type === "spouse";
    const children = (edge.data as { children?: boolean } | undefined)?.children;
    const divorced = married && (edge.data as SpouseEdgeData).link.status === "divorced";
    const dashed = !married || divorced;
    out.push(
      `<path d="${married ? `${line(1)} ${line(-1)}` : line(0)}" fill="none" stroke="${married ? COLOURS.marriage : COLOURS.pair}" stroke-width="1.5"${dashed ? ' stroke-dasharray="6 4"' : ""}/>`,
    );
    if (children) {
      const junction = midpoint(pa, pb);
      out.push(
        `<circle cx="${n(junction.x)}" cy="${n(junction.y)}" r="4.5" fill="${COLOURS.marriage}"/>`,
      );
    }
  }

  // People in front.
  snapshot.nodes.forEach((node, index) => {
    const c = centre(node);
    const { person, years, colour, folds } = node.data;
    if (unknown(node)) {
      out.push(
        `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="15" fill="#ffffff" stroke="${COLOURS.border}" stroke-width="2" stroke-dasharray="3 2"/>`,
        `<text x="${n(c.x)}" y="${n(c.y + 4)}" text-anchor="middle" font-size="12" fill="${COLOURS.label}">?</text>`,
      );
      return;
    }
    const photo = photos.get(person.id);
    if (photo) {
      out.push(
        `<clipPath id="photo${index}"><circle cx="${n(c.x)}" cy="${n(c.y)}" r="25"/></clipPath>`,
        `<image href="${photo}" x="${n(c.x - 25)}" y="${n(c.y - 25)}" width="50" height="50" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo${index})"/>`,
      );
    } else {
      out.push(
        `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="25" fill="${COLOURS.initialsBackground}"/>`,
        `<text x="${n(c.x)}" y="${n(c.y + 5.5)}" text-anchor="middle" font-size="16" font-weight="600" fill="${COLOURS.initials}">${xml(initials(person.full_name))}</text>`,
      );
    }
    out.push(
      `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="26.5" fill="none" stroke="${colour ?? COLOURS.border}" stroke-width="3"/>`,
    );
    const lines = wrapName(person.full_name, NODE_WIDTH, measure);
    const top = node.position.y + PHOTO + 6;
    lines.forEach((text, line) => {
      out.push(
        `<text x="${n(c.x)}" y="${n(top + 11.5 + line * 15)}" text-anchor="middle" font-size="12" font-weight="500" fill="${COLOURS.name}">${xml(text)}</text>`,
      );
    });
    if (years) {
      out.push(
        `<text x="${n(c.x)}" y="${n(top + lines.length * 15 + 12.5)}" text-anchor="middle" font-size="11" fill="${COLOURS.years}">${xml(years)}</text>`,
      );
    }
    folds
      .filter((fold) => !fold.open)
      .forEach((fold, row) => {
        const label = `+${fold.size}`;
        const textWidth = measure(label, `600 11px ${FAMILY}`);
        const [x, y] = [node.position.x + 86, node.position.y + 36 + row * 24];
        out.push(
          `<rect x="${n(x)}" y="${n(y)}" width="${n(textWidth + 12)}" height="20" rx="10" fill="${COLOURS.amberBackground}" stroke="${COLOURS.amber}"/>`,
          `<text x="${n(x + 6)}" y="${n(y + 14)}" font-size="11" font-weight="600" fill="${COLOURS.amberText}">${label}</text>`,
        );
      });
  });

  out.push("</svg>");
  return { svg: out.join("\n"), width, height };
}

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read a file."));
    reader.readAsDataURL(blob);
  });
}

async function photosOf(nodes: PersonFlowNode[]): Promise<Map<string, string>> {
  const wanted = nodes
    .map((node) => node.data.person)
    .filter((person) => !person.placeholder && person.photo_version !== null);
  const photos = new Map<string, string>();
  let next = 0;
  // A few at a time: the server is on this PC, but a big family has hundreds of photos.
  const worker = async () => {
    while (next < wanted.length) {
      const person = wanted[next++];
      if (!person) break;
      const response = await fetch(avatarAddress(person.id, 128, person.photo_version ?? 0));
      if (response.ok) photos.set(person.id, await asDataUrl(await response.blob()));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return photos;
}

async function fontFace(): Promise<string> {
  const response = await fetch(geistUrl);
  if (!response.ok) return "";
  const font = await asDataUrl(await response.blob());
  return `@font-face{font-family:"${FAMILY}";src:url(${font}) format("woff2");font-weight:100 900}`;
}

/** The picture, with every photo and the font inside it. */
export async function treePicture(snapshot: TreeSnapshot): Promise<Picture> {
  await document.fonts.ready;
  const context = document.createElement("canvas").getContext("2d");
  const measure: Measure = (text, font) => {
    if (!context) return text.length * 7;
    context.font = font;
    return context.measureText(text).width;
  };
  const [face, photos] = await Promise.all([fontFace(), photosOf(snapshot.nodes)]);
  return drawTree(snapshot, { photos, fontFace: face, measure });
}

// Browsers draw canvases up to about 16,000 pixels a side; keep well inside that.
const MAX_SIDE = 12_000;

/** The picture as PNG, at `scale` times its size (2: sharp enough to print), if it fits. */
export async function asPng(picture: Picture, scale = 2): Promise<Blob> {
  const fit = Math.min(scale, MAX_SIDE / picture.width, MAX_SIDE / picture.height);
  const url = URL.createObjectURL(new Blob([picture.svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(picture.width * fit);
    canvas.height = Math.round(picture.height * fit);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't draw the picture.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("The picture is too big to save."))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Save something made in the browser as a download. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
