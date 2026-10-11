import "@mdxeditor/editor/style.css";
import {
  addImportVisitor$,
  type CodeBlockEditorDescriptor,
  codeBlockPlugin,
  headingsPlugin,
  imagePlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  type MdastImportVisitor,
  quotePlugin,
  type RealmPlugin,
  realmPlugin,
  tablePlugin,
  thematicBreakPlugin,
} from "@mdxeditor/editor";
import { type MouseEvent, memo, useEffect, useMemo, useRef, useState } from "react";
import { Diagram } from "./Diagram";
import { linkTarget, pictureUrl, type Section } from "./guide";

type MdastNode = Parameters<Exclude<MdastImportVisitor<never>["testNode"], string>>[0];
type ListNode = Extract<MdastNode, { type: "list" }>;
// What MDXEditor's reader of lists leaves: the list, or the list item it put the list in.
type Made = {
  getType(): string;
  getNextSibling(): Made | null;
  getLastChild?(): Made | null;
  setStart?(start: number): unknown;
};

/**
 * A numbered list counted from its first number, as on GitHub: the guide's contents go on from
 * 5 in Part 2. MDXEditor's own reader starts every list at 1.
 */
const numberedFrom: MdastImportVisitor<ListNode> = {
  testNode: (node) => node.type === "list" && Boolean(node.ordered) && (node.start ?? 1) !== 1,
  priority: 100,
  visitNode({ mdastNode, lexicalParent, actions }) {
    actions.nextVisitor();
    // Where that reader put it: last in its parent or, inside a list item, in the item after.
    const parent = lexicalParent as unknown as Made;
    const holder = parent.getType() === "listitem" ? parent.getNextSibling() : parent;
    holder?.getLastChild?.()?.setStart?.(mdastNode.start ?? 1);
  },
};
const listsFromTheirStart = realmPlugin({
  init(realm) {
    realm.pubIn({ [addImportVisitor$]: numberedFrom });
  },
});

/** Diagrams written in the guide as Mermaid, drawn; any other code, as it's written. */
const DIAGRAMS: CodeBlockEditorDescriptor = {
  match: (language) => language === "mermaid",
  priority: 1,
  Editor: ({ code }) => <Diagram text={code} />,
};
const CODE: CodeBlockEditorDescriptor = {
  match: () => true,
  priority: 0,
  Editor: ({ code }) => <pre className="guide-code">{code}</pre>,
};

/**
 * What the guide holds, read as life stories are read, with MDXEditor: headings, lists,
 * quotes, links, dividers, tables, pictures and diagrams.
 */
const PLUGINS: RealmPlugin[] = [
  headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }),
  listsPlugin(),
  listsFromTheirStart(),
  quotePlugin(),
  linkPlugin(),
  thematicBreakPlugin(),
  tablePlugin(),
  imagePlugin({
    imagePreviewHandler: async (src) => pictureUrl(src),
    disableImageResize: true,
    disableImageSettingsButton: true,
  }),
  codeBlockPlugin({ codeBlockEditorDescriptors: [DIAGRAMS, CODE] }),
];

const IMG = /^<img\b([^<>]*)>$/i;

/**
 * A picture the guide writes as HTML, `<img src alt width>`, so that GitHub shows it smaller,
 * as Markdown, with its width kept aside for the app to show it at the same.
 */
export function withPictures(markdown: string): { markdown: string; widths: Map<string, number> } {
  const widths = new Map<string, number>();
  const lines = markdown.split("\n").map((line) => {
    const found = IMG.exec(line.trim());
    if (!found) return line;
    const attributes = new Map(
      [...(found[1] ?? "").matchAll(/(\w+)="([^"]*)"/g)].map(([, name, value]) => [
        (name ?? "").toLowerCase(),
        value ?? "",
      ]),
    );
    const src = attributes.get("src") ?? "";
    const width = Number(attributes.get("width"));
    if (width > 0) widths.set(pictureUrl(src), width);
    const alt = (attributes.get("alt") ?? "").replace(/[[\]]/g, "");
    return `![${alt}](${src})`;
  });
  return { markdown: lines.join("\n"), widths };
}

type Props = {
  section: Section;
  target: string; // the heading asked for: the section's own, or one inside it
  onOpen: (slug: string) => void;
  onPicture: (picture: { src: string; alt: string }) => void;
};

/**
 * One section of the guide. Its links lead where the guide's links lead on GitHub: another
 * section here, or the web in the browser. Its pictures open larger.
 */
export const GuideText = memo(function GuideText({ section, target, onOpen, onPicture }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [unreadable, setUnreadable] = useState(false);
  const { markdown, widths } = useMemo(() => withPictures(section.markdown), [section]);

  // As the editor draws it: each heading given GitHub's address, each picture its width, and
  // the place asked for brought into view, once.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let shown = false;
    const settle = () => {
      element.querySelectorAll("h1, h2, h3").forEach((heading, index) => {
        const slug = section.headings[index]?.slug;
        if (slug && heading.id !== slug) heading.id = slug;
      });
      for (const picture of element.querySelectorAll("img")) {
        const width = widths.get(picture.getAttribute("src") ?? "");
        if (width && picture.style.width !== `${width}px`) picture.style.width = `${width}px`;
      }
      if (shown) return;
      const at =
        target === section.slug
          ? element
          : [...element.querySelectorAll("[id]")].find((each) => each.id === target);
      if (at) {
        shown = true;
        at.scrollIntoView?.({ block: "start" });
      }
    };
    settle();
    const watching = new MutationObserver(settle);
    watching.observe(element, { childList: true, subtree: true });
    return () => watching.disconnect();
  }, [section, target, widths]);

  const click = (event: MouseEvent<HTMLDivElement>) => {
    const element = event.target as HTMLElement;
    const link = element.closest("a");
    if (link) {
      event.preventDefault();
      const to = linkTarget(link.getAttribute("href") ?? "");
      if (to && "section" in to) onOpen(to.section);
      else if (to) window.open(to.web, "_blank", "noopener");
      return;
    }
    if (element instanceof HTMLImageElement && element.src) {
      onPicture({ src: element.src, alt: element.alt });
    }
  };

  if (unreadable) {
    return (
      <pre className="guide-code guide-unreadable whitespace-pre-wrap">{section.markdown}</pre>
    );
  }
  return (
    // The clicks caught here are the links' own, which the keyboard reaches as links, and the
    // pictures', which open larger.
    <div ref={box} className="guide-text" onClickCapture={click}>
      <MDXEditor
        key={section.slug}
        markdown={markdown}
        plugins={PLUGINS}
        readOnly
        suppressHtmlProcessing
        className="guide-editor"
        contentEditableClassName="guide"
        onError={() => setUnreadable(true)}
      />
    </div>
  );
});
