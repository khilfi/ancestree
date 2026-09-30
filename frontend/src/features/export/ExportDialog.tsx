import {
  ArchiveIcon,
  DownloadIcon,
  FilePlusIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  ImageIcon,
  type LucideIcon,
  PencilIcon,
  SaveIcon,
  Share2Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { downloadExport, downloadTemplate, useMakeExport } from "@/api/queries";
import type { ExportFormat } from "@/api/types";
import { useSaveCopy } from "@/app/CopyEditBar";
import { type CopyControls, InAppOnly, useCopy, useCopyControls } from "@/app/copy";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { asPng, saveFile, treePicture } from "@/features/tree/picture";
import { fileSize } from "@/lib/files";
import { showError } from "@/lib/notify";
import { CopyDialog } from "./CopyDialog";
import { useTreePicture } from "./treePicture";

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function Choice({
  icon: Icon,
  title,
  kind,
  children,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  kind: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-stone-500" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium text-stone-900">
          {title} <span className="text-xs font-normal text-stone-500">{kind}</span>
        </p>
        <p className="text-sm text-stone-600">{children}</p>
      </div>
      <div className="flex shrink-0 gap-1.5">{actions}</div>
    </li>
  );
}

/** A copy to edit's own export: itself, with the changes inside. */
function SaveCopyChoice({ controls, onSaved }: { controls: CopyControls; onSaved: () => void }) {
  const { save, saving } = useSaveCopy(controls);
  return (
    <Choice
      icon={SaveIcon}
      title="Save a new copy"
      kind=".html"
      actions={
        <Button
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => {
            onSaved();
            save();
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      }
    >
      This copy with your changes inside, as a new file: send it back to whoever gave you this copy.
    </Choice>
  );
}

/** The top bar's Export: the whole family in each of its forms. In a view-only
 *  copy, the files made with the copy, and the import template for sending additions.
 *  In a copy to edit, the copy itself with its changes, and a picture of the tree: the
 *  files made with it would be out of date after its first change. */
export function ExportButton() {
  const [open, setOpen] = useState(false);
  const [copying, setCopying] = useState<"view" | "edit" | null>(null);
  const make = useMakeExport();
  const picture = useTreePicture();
  const copy = useCopy();
  const controls = useCopyControls();
  const editing = copy?.editing ?? null;
  const [busy, setBusy] = useState<string | null>(null);

  async function exportFile(format: ExportFormat) {
    setBusy(format);
    try {
      const file = await make.mutateAsync(format);
      downloadExport(file.name);
      toast.success(`Saved ${file.name} (${fileSize(file.size)}).`, {
        // A copy's files come from the copy itself: there's no folder they stay in.
        description: file.folder ? `A copy stays in ${file.folder}.` : undefined,
      });
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function exportPicture(kind: "png" | "svg") {
    if (!picture) return;
    setBusy(kind);
    try {
      const drawn = await treePicture(picture());
      const blob =
        kind === "svg" ? new Blob([drawn.svg], { type: "image/svg+xml" }) : await asPng(drawn);
      const name = `ancestree-tree-${today()}.${kind}`;
      saveFile(blob, name);
      toast.success(`Saved ${name} (${fileSize(blob.size)}).`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  const button = (label: string, key: string, what: string, run: () => void, disabled = false) => (
    <Button
      variant="outline"
      size="sm"
      onClick={run}
      disabled={busy !== null || disabled}
      aria-label={what}
    >
      {busy === key ? "Making…" : label}
    </Button>
  );

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Export"
        title="Export: the full archive, GEDCOM, a spreadsheet or a picture"
      >
        <DownloadIcon />
        {/* The word where the top bar has room; the icon alone where it's short. */}
        <span className="hidden xl:inline">Export</span>
      </Button>
      <Dialog open={open} onOpenChange={(next) => busy === null && setOpen(next)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Export</DialogTitle>
            <DialogDescription>
              {editing
                ? "This copy with your changes, to send back, or a picture of the tree."
                : copy
                  ? "The family in this copy, in files that open without AncesTree."
                  : "Everything you've put into AncesTree, in files that open without it."}
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-stone-100">
            {editing && controls && (
              <SaveCopyChoice controls={controls} onSaved={() => setOpen(false)} />
            )}
            <InAppOnly>
              <Choice
                icon={Share2Icon}
                title="View-only copy"
                kind=".html"
                actions={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => {
                      setOpen(false);
                      setCopying("view");
                    }}
                  >
                    Make a copy…
                  </Button>
                }
              >
                The app with your family inside, to give to relatives: it opens in any browser, and
                nothing in it can be changed.
              </Choice>
              <Choice
                icon={PencilIcon}
                title="Copy to edit"
                kind=".html"
                actions={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => {
                      setOpen(false);
                      setCopying("edit");
                    }}
                  >
                    Make a copy…
                  </Button>
                }
              >
                The same, made for one relative, who can add and correct people in it and send it
                back to you. Nothing in it reaches the family until you approve it.
              </Choice>
            </InAppOnly>
            {!editing && (
              <>
                <Choice
                  icon={ArchiveIcon}
                  title="Full archive"
                  kind=".zip"
                  actions={button(
                    "Download",
                    "archive",
                    "Download the full archive",
                    () => exportFile("archive"),
                    copy !== null && !copy.archive,
                  )}
                >
                  {!copy
                    ? "Everything: people, links, photos, stories and settings. For backups and moving to a new PC; restore it in Settings."
                    : copy.archive
                      ? "Everything, as it was when this copy was made: people, links, photos, stories and settings. It can be restored in AncesTree."
                      : "Not in this copy."}
                </Choice>
                <Choice
                  icon={FileTextIcon}
                  title="GEDCOM"
                  kind=".ged"
                  actions={button("Download", "gedcom", "Download a GEDCOM file", () =>
                    exportFile("gedcom"),
                  )}
                >
                  {copy?.hidden_living
                    ? "For other family-history programs, such as Gramps: people and families, with living people's details left out as they are here. Photos aren't in it."
                    : `For other family-history programs, such as Gramps: people, families, dates, places, notes and stories. ${copy && !copy.archive ? "Photos aren't in it." : "Photos stay in the full archive."}`}
                </Choice>
                <Choice
                  icon={FileSpreadsheetIcon}
                  title="Spreadsheet"
                  kind=".csv"
                  actions={button("Download", "csv", "Download the spreadsheet", () =>
                    exportFile("csv"),
                  )}
                >
                  One row per person, for Excel.
                </Choice>
              </>
            )}
            <Choice
              icon={ImageIcon}
              title="Picture of the tree"
              kind=".png or .svg"
              actions={
                <>
                  {button(
                    "PNG",
                    "png",
                    "Save the tree as PNG",
                    () => exportPicture("png"),
                    !picture,
                  )}
                  {button(
                    "SVG",
                    "svg",
                    "Save the tree as SVG",
                    () => exportPicture("svg"),
                    !picture,
                  )}
                </>
              }
            >
              {picture ? (
                "The tree as it's arranged now, for printing. SVG stays sharp at any size."
              ) : (
                <>
                  The tree as it's arranged on screen.{" "}
                  <Link to="/tree" className="underline" onClick={() => setOpen(false)}>
                    Open the tree
                  </Link>{" "}
                  to save a picture of it.
                </>
              )}
            </Choice>
            {copy && !editing && (
              <Choice
                icon={FilePlusIcon}
                title="Import template"
                kind=".csv"
                actions={button("Download", "template", "Download the import template", () =>
                  downloadTemplate(false),
                )}
              >
                For adding people or correcting details: fill it in with Excel and send it back to
                whoever gave you this copy.
              </Choice>
            )}
          </ul>
        </DialogContent>
      </Dialog>
      {copying && (
        <CopyDialog
          toEdit={copying === "edit"}
          open
          onOpenChange={(next) => !next && setCopying(null)}
        />
      )}
    </>
  );
}
