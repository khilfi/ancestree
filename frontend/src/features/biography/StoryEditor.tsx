import "@mdxeditor/editor/style.css";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  closeImageDialog$,
  InsertImage,
  imageDialogState$,
  ListsToggle,
  MDXEditor,
  Separator,
  saveImage$,
  type Translation,
  toolbarPlugin,
  UndoRedo,
  useCellValue,
  usePublisher,
} from "@mdxeditor/editor";
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { addPicture } from "@/api/queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError } from "@/lib/notify";
import { needsPlainText, pictureUrl, STORY_MARKDOWN, storyPlugins } from "./story";

const MAX_BYTES = 20 * 1024 * 1024; // the server's limit too

/** The editor's own words, in the app's plain language. */
const WORDS: Record<string, string> = {
  "toolbar.blockTypes.paragraph": "Normal text",
  "toolbar.blockTypeSelect.placeholder": "Style",
  "toolbar.blockTypeSelect.selectBlockTypeTooltip": "Heading, quote or normal text",
  "toolbar.image": "Add a picture",
  "toolbar.link": "Add a link",
  "imageEditor.editImage": "Change the caption",
  "imageEditor.deleteImage": "Remove the picture",
  "createLink.url": "Web address",
  "createLink.urlPlaceholder": "Paste a web address",
  "createLink.text": "Text",
  "createLink.title": "Shown when pointing at it",
  "createLink.saveTooltip": "Save the link",
  "linkPreview.edit": "Change the link",
  "linkPreview.remove": "Remove the link",
};

const translate: Translation = (key, fallback, values = {}) => {
  if (key === "toolbar.blockTypes.heading") return values.level === 2 ? "Heading" : "Subheading";
  let text = WORDS[key] ?? fallback;
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`{{${name}}}`, String(value));
  }
  return text;
};

function Toolbar() {
  return (
    <>
      <UndoRedo />
      <Separator />
      <BlockTypeSelect />
      <Separator />
      <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
      <ListsToggle options={["bullet", "number"]} />
      <Separator />
      <CreateLink />
      <InsertImage />
    </>
  );
}

const PersonId = createContext("");

/** Whether the browser can show this image; HEIC, for one, usually can't be. */
function canPreview(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

type Chosen = { file: File; url: string | null };

/**
 * Adding a picture, or changing its caption. The picture is stored in the person's media/
 * folder only when it's added, so a cancelled choice leaves nothing behind.
 */
function PictureDialog() {
  const personId = useContext(PersonId);
  const state = useCellValue(imageDialogState$);
  const saveImage = usePublisher(saveImage$);
  const close = usePublisher(closeImageDialog$);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCaption(state.type === "editing" ? (state.initialValues.altText ?? "") : "");
    setChosen(null);
  }, [state]);
  useEffect(() => () => void (chosen?.url && URL.revokeObjectURL(chosen.url)), [chosen]);

  async function choose(file: File) {
    if (file.size > MAX_BYTES) {
      showError(new Error("That picture is larger than 20 MB. Try a smaller copy."));
      return;
    }
    const url = URL.createObjectURL(file);
    const shown = await canPreview(url);
    if (!shown) URL.revokeObjectURL(url);
    setChosen({ file, url: shown ? url : null });
  }

  async function submit() {
    if (state.type === "editing") {
      const { src = "", title = "" } = state.initialValues;
      saveImage({ src, title, altText: caption.trim() });
      return;
    }
    if (!chosen) return;
    setBusy(true);
    try {
      const { src } = await addPicture(personId, chosen.file);
      saveImage({ src, title: "", altText: caption.trim() });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  const editing = state.type === "editing";
  const preview = editing
    ? pictureUrl(personId, state.initialValues.src ?? "")
    : (chosen?.url ?? null);
  return (
    <Dialog open={state.type !== "inactive"} onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Picture" : "Add a picture"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "The caption is kept with the picture in the story."
              : "JPEG, PNG, WebP, HEIC, GIF, BMP or TIFF, up to 20 MB. It's kept in this person's media folder."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {preview && (
            <img
              src={preview}
              alt=""
              className="mx-auto max-h-56 rounded-md object-contain ring-1 ring-stone-200"
            />
          )}
          {!editing && chosen && !chosen.url && (
            <p className="text-center text-sm text-stone-600">
              {chosen.file.name} (this browser can't show it, but it will be added)
            </p>
          )}
          {!editing && (
            <div className="flex justify-center">
              <Button
                variant={chosen ? "outline" : "default"}
                onClick={() => input.current?.click()}
                disabled={busy}
              >
                {chosen ? "Choose another…" : "Choose a picture…"}
              </Button>
              <input
                ref={input}
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = ""; // choosing the same file again still triggers a change
                  if (file) void choose(file);
                }}
              />
            </div>
          )}
          {(editing || chosen) && (
            <div className="space-y-1.5">
              <Label htmlFor="picture-caption">Caption (optional)</Label>
              <Input
                id="picture-caption"
                value={caption}
                maxLength={300}
                placeholder="e.g. At the wedding, 1965"
                onChange={(event) => setCaption(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                }}
              />
              <p className="text-xs text-stone-500">
                Read aloud by screen readers, and shown in Notepad.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close()} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || (!editing && !chosen)}>
            {busy ? "Adding…" : editing ? "Save" : "Add picture"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Props = {
  personId: string;
  markdown: string; // read once: a new story means a new editor (a new `key`)
  onChange: (markdown: string) => void;
  onUnreadable: () => void; // the story has something the editor would lose
  readOnly?: boolean; // a view-only copy: the story shown as the editor shows it
};

/** The word-processor view of a life story. What's typed comes out as plain Markdown. */
export const StoryEditor = memo(function StoryEditor({
  personId,
  markdown,
  onChange,
  onUnreadable,
  readOnly = false,
}: Props) {
  const unreadable = needsPlainText(markdown);
  useEffect(() => {
    if (unreadable) onUnreadable();
  }, [unreadable, onUnreadable]);

  const plugins = useMemo(
    () =>
      readOnly
        ? storyPlugins({ preview: async (src) => pictureUrl(personId, src) })
        : [
            toolbarPlugin({ toolbarContents: Toolbar, toolbarClassName: "story-toolbar" }),
            ...storyPlugins({
              // Dropped or pasted pictures; the toolbar's go through PictureDialog.
              upload: async (file) => {
                try {
                  return (await addPicture(personId, file)).src;
                } catch (error) {
                  showError(error);
                  throw error;
                }
              },
              preview: async (src) => pictureUrl(personId, src),
              dialog: PictureDialog,
            }),
          ],
    [personId, readOnly],
  );

  if (unreadable) return null;
  return (
    <PersonId.Provider value={personId}>
      <MDXEditor
        markdown={markdown}
        plugins={plugins}
        readOnly={readOnly}
        // The first call only tidies the story as read: that isn't an edit.
        onChange={(text, tidying) => {
          if (!tidying) onChange(text);
        }}
        onError={onUnreadable}
        suppressHtmlProcessing
        toMarkdownOptions={STORY_MARKDOWN}
        translation={translate}
        className="story-editor"
        contentEditableClassName="story"
        placeholder="Write about their life: where they grew up, their work, the family they raised…"
      />
    </PersonId.Provider>
  );
});
