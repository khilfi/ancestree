/**
 * How a life story is read into the editor and written back as Markdown.
 * Shared by the editor and its round-trip test, so what's tested is what's used.
 */
import {
  addImportVisitor$,
  headingsPlugin,
  type ImageUploadHandler,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  type MDXEditorProps,
  type MdastImportVisitor,
  markdownShortcutPlugin,
  quotePlugin,
  type RealmPlugin,
  realmPlugin,
  thematicBreakPlugin,
  UnrecognizedMarkdownConstructError,
} from "@mdxeditor/editor";
import type { FC } from "react";
import { storyPictureAddress } from "@/api/addresses";

/** How the story is written: plain Markdown that reads well in Notepad, with "-" bullets. */
export const STORY_MARKDOWN: MDXEditorProps["toMarkdownOptions"] = {
  listItemIndent: "one",
  bullet: "-",
  emphasis: "*",
  strong: "*",
  rule: "-",
};

type MdastNode = Parameters<Exclude<MdastImportVisitor<never>["testNode"], string>>[0];
type HtmlNode = Extract<MdastNode, { type: "html" }>;
type Visit = Parameters<MdastImportVisitor<HtmlNode>["visitNode"]>[0];
type MdastParent = Parameters<Visit["actions"]["visitChildren"]>[0];

const LONE_IMG = /^<img\b[^<>]*>$/i;

/**
 * A picture written as HTML, `<img src="…">`, e.g. by another editor. MDXEditor's own reader
 * parses it with innerHTML on the live page, where an `onerror` in the file would run. This one
 * reads it in an inert document and passes on only the picture, as if written in Markdown.
 * Any other HTML isn't shown in the editor at all (suppressHtmlProcessing): the story then
 * opens as plain text.
 */
const safeHtmlPicture: MdastImportVisitor<HtmlNode> = {
  testNode: (node) => node.type === "html" && node.value.trimStart().startsWith("<img"),
  priority: 100,
  visitNode({ mdastNode, lexicalParent, actions }) {
    const html = mdastNode.value.trim();
    const img = LONE_IMG.test(html)
      ? new DOMParser().parseFromString(html, "text/html").querySelector("img")
      : null;
    if (!img) throw new UnrecognizedMarkdownConstructError(`Unsupported HTML: ${html}`);
    const picture = {
      type: "image",
      url: img.getAttribute("src") ?? "",
      alt: img.getAttribute("alt") ?? "",
      title: img.getAttribute("title") || null,
    };
    // Pictures sit inside a paragraph, as when written in Markdown.
    const inline = lexicalParent.getType() !== "root";
    const children = inline ? [picture] : [{ type: "paragraph", children: [picture] }];
    actions.visitChildren({ type: "paragraph", children } as unknown as MdastParent, lexicalParent);
  },
};

const safePictures = realmPlugin({
  init(realm) {
    realm.pubIn({ [addImportVisitor$]: safeHtmlPicture });
  },
});

type Pictures = {
  upload?: ImageUploadHandler;
  preview?: (src: string) => Promise<string>;
  dialog?: FC;
};

/** Everything a story may contain: headings, lists, quotes, links, pictures, dividers. */
export function storyPlugins(pictures: Pictures = {}): RealmPlugin[] {
  return [
    headingsPlugin({ allowedHeadingLevels: [2, 3] }),
    listsPlugin(),
    quotePlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    thematicBreakPlugin(),
    imagePlugin({
      imageUploadHandler: pictures.upload ?? null,
      imagePreviewHandler: pictures.preview ?? null,
      ImageDialog: pictures.dialog,
      disableImageResize: true, // a resized picture would be written as HTML
    }),
    safePictures(),
    markdownShortcutPlugin(),
  ];
}

const MEDIA = /^media\/[0-9a-z][0-9a-z-]*\.webp$/;

/**
 * Where the browser finds a picture named in the story: the person's own media/ folder, or the
 * web. Anything else (javascript:, file:) isn't shown.
 */
export function pictureUrl(personId: string, src: string): string {
  if (MEDIA.test(src)) return storyPictureAddress(personId, src);
  if (/^(https?:\/\/|data:image\/)/i.test(src)) return src;
  return "";
}

/**
 * Stories the rich editor would change on the next save, so they open as plain text instead.
 * From Obsidian: a properties block at the top (it would become a divider and a heading), and
 * [[links]] and footnotes[^1] (their brackets would gain backslashes).
 */
export function needsPlainText(story: string): boolean {
  return /^---\r?\n/.test(story) || /\[\[[^\]\n]+\]\]|\[\^[^\]\n]+\]/.test(story);
}
