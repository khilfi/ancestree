import { ChevronDownIcon, DownloadIcon, FilePlusIcon, ImageIcon, Share2Icon } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { saveDrawn } from "@/api/downloads";
import { downloadTemplate } from "@/api/queries";
import { InAppOnly, useCopy } from "@/app/copy";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { viewSearch } from "@/features/tree/filters";
import { asPng, treePicture } from "@/features/tree/picture";
import { fileSize } from "@/lib/files";
import { showError } from "@/lib/notify";
import { useTreePicture } from "./treePicture";

function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The tree as it's arranged now, saved as PNG or SVG: while a tree is on screen. */
function useTreePictureSaver() {
  const picture = useTreePicture();
  const [busy, setBusy] = useState(false);

  async function save(kind: "png" | "svg") {
    if (!picture || busy) return;
    setBusy(true);
    try {
      const drawn = await treePicture(picture());
      const blob =
        kind === "svg" ? new Blob([drawn.svg], { type: "image/svg+xml" }) : await asPng(drawn);
      const name = `ancestree-tree-${today()}.${kind}`;
      if (await saveDrawn(blob, name)) return; // said where it went
      toast.success(`Saved ${name} (${fileSize(blob.size)}).`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  return { shown: picture !== null, busy, save };
}

/**
 * What Export offers, a short menu: **View-only copy…**, which
 * opens its dialog through `onCopy`, and **Picture of the tree**, as PNG or SVG. In a view-only
 * copy, the picture and the import template, for sending additions. The same items are
 * the top bar's **Export**, and, where the bar has no room for it, in its **More**.
 */
export function ExportItems({ onCopy }: { onCopy: () => void }) {
  const copy = useCopy();
  const picture = useTreePictureSaver();
  const navigate = useNavigate();
  const kept = viewSearch(new URLSearchParams(useLocation().search));

  return (
    <>
      <InAppOnly>
        <DropdownMenuItem onSelect={onCopy}>
          <Share2Icon />
          View-only copy…
        </DropdownMenuItem>
      </InAppOnly>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <ImageIcon />
          Picture of the tree
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-60">
          {picture.shown ? (
            <>
              <DropdownMenuItem disabled={picture.busy} onSelect={() => picture.save("png")}>
                <span className="flex flex-col">
                  <span>PNG</span>
                  <span className="text-xs text-faint">A picture, for printing</span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={picture.busy} onSelect={() => picture.save("svg")}>
                <span className="flex flex-col">
                  <span>SVG</span>
                  <span className="text-xs text-faint">Stays sharp at any size</span>
                </span>
              </DropdownMenuItem>
            </>
          ) : (
            // The tree as it's arranged on screen: away from it, there's none to draw.
            <DropdownMenuItem onSelect={() => navigate({ pathname: "/tree", search: kept })}>
              <span className="flex flex-col">
                <span>Open the tree</span>
                <span className="text-xs text-faint">To save a picture of it</span>
              </span>
            </DropdownMenuItem>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {copy && (
        <DropdownMenuItem onSelect={() => downloadTemplate(false)}>
          <FilePlusIcon />
          <span className="flex flex-col">
            <span>Import template</span>
            <span className="text-xs text-faint">
              To add people or correct details in Excel, and send it back
            </span>
          </span>
        </DropdownMenuItem>
      )}
    </>
  );
}

/** The top bar's **Export**, where the bar has room for it: a short menu. */
export function ExportMenu({ onCopy }: { onCopy: () => void }) {
  const copy = useCopy();
  return (
    <DropdownMenu>
      <Hint
        label={
          copy
            ? "Export: a picture of the tree, or the import template"
            : "Export: a view-only copy or a picture of the tree"
        }
      >
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <DownloadIcon />
            Export
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" className="w-56">
        <ExportItems onCopy={onCopy} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
