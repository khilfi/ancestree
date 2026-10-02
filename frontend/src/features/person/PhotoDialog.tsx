import { useRef, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { toast } from "sonner";
import { displayPhotoAddress } from "@/api/addresses";
import { usePhotoCrop, useRecropPhoto, useRemovePhoto, useUploadPhoto } from "@/api/queries";
import type { Crop, PersonDetail } from "@/api/types";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { showError } from "@/lib/notify";

const MAX_BYTES = 20 * 1024 * 1024; // the server's limit too

type Stage =
  | { step: "menu" }
  // `file` is null when re-cropping the photo already saved.
  | { step: "crop"; src: string; file: File | null; start: Crop | null };

/** Whether the browser can show this image; HEIC, for one, usually can't be. */
function canPreview(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

/** Choose, crop, re-crop or remove someone's photo. Originals are always kept on disk. */
export function PhotoDialog({
  person,
  open,
  onOpenChange,
}: {
  person: PersonDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [stage, setStage] = useState<Stage>({ step: "menu" });
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hasPhoto = person.photo_version !== null;
  const savedCrop = usePhotoCrop(person.id, open && hasPhoto);
  const upload = useUploadPhoto(person.id);
  const recrop = useRecropPhoto(person.id);
  const remove = useRemovePhoto(person.id);
  const busy = upload.isPending || recrop.isPending || remove.isPending;
  const canRecrop = hasPhoto;

  function displayUrl(version: number | null): string {
    return displayPhotoAddress(person.id, version ?? 0);
  }

  function startCrop(src: string, file: File | null, start: Crop | null) {
    setPosition({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    setStage({ step: "crop", src, file, start });
  }

  function reset() {
    if (stage.step === "crop" && stage.file) URL.revokeObjectURL(stage.src);
    setStage({ step: "menu" });
    setConfirmRemove(false);
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  async function pick(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error("That photo is larger than 20 MB. Try a smaller copy.");
      return;
    }
    const url = URL.createObjectURL(file);
    if (await canPreview(url)) {
      startCrop(url, file, null);
      return;
    }
    URL.revokeObjectURL(url);
    // The server can read what the browser can't: save it first, then crop its upright copy.
    try {
      const saved = await upload.mutateAsync({ file, crop: null });
      toast.info("Photo saved, centred. Adjust the crop if you like.");
      startCrop(displayUrl(saved.photo_version), null, null);
    } catch (error) {
      showError(error);
    }
  }

  async function save() {
    if (stage.step !== "crop" || !area) return;
    const crop: Crop = { x: area.x, y: area.y, width: area.width, height: area.height };
    try {
      if (stage.file) await upload.mutateAsync({ file: stage.file, crop });
      else await recrop.mutateAsync(crop);
      toast.success("Photo saved.");
      close();
    } catch (error) {
      showError(error);
    }
  }

  async function removePhoto() {
    try {
      await remove.mutateAsync();
      toast.success("Photo removed. The file is still in the person's folder.");
      close();
    } catch (error) {
      showError(error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Photo of {person.nickname || person.full_name}</DialogTitle>
          <DialogDescription>
            {stage.step === "crop"
              ? "Drag to move the photo, and zoom to fit the face in the circle."
              : "JPEG, PNG, WebP, HEIC, GIF, BMP or TIFF, up to 20 MB."}
          </DialogDescription>
        </DialogHeader>

        {stage.step === "crop" ? (
          <div className="space-y-4">
            <div className="relative h-72 overflow-hidden rounded-lg bg-stone-900">
              <Cropper
                image={stage.src}
                crop={position}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                initialCroppedAreaPercentages={stage.start ?? undefined}
                onCropChange={setPosition}
                onZoomChange={setZoom}
                onCropComplete={(croppedArea) => setArea(croppedArea)}
              />
            </div>
            <Slider
              aria-label="Zoom"
              min={1}
              max={4}
              step={0.01}
              value={[zoom]}
              onValueChange={(values) => setZoom(values[0] ?? 1)}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-2">
            <PersonAvatar person={person} size="lg" />
            {confirmRemove ? (
              <div className="space-y-3 text-center">
                <p>Remove this photo? The file stays in the person's folder.</p>
                <div className="flex justify-center gap-2">
                  <Button variant="destructive" onClick={removePhoto} disabled={busy}>
                    Remove photo
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
                    Keep it
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => input.current?.click()} disabled={busy}>
                  {hasPhoto ? "Choose another photo…" : "Choose a photo…"}
                </Button>
                {canRecrop && (
                  <Button
                    variant="outline"
                    disabled={busy || savedCrop.isPending}
                    onClick={() =>
                      startCrop(displayUrl(person.photo_version), null, savedCrop.data ?? null)
                    }
                  >
                    Adjust crop
                  </Button>
                )}
                {hasPhoto && (
                  <Button variant="ghost" onClick={() => setConfirmRemove(true)} disabled={busy}>
                    Remove
                  </Button>
                )}
              </div>
            )}
            {busy && <p className="text-xs text-stone-500">Working on the photo…</p>}
            <input
              ref={input}
              type="file"
              accept="image/*,.heic,.heif"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = ""; // choosing the same file again still triggers a change
                if (file) void pick(file);
              }}
            />
          </div>
        )}

        {stage.step === "crop" && (
          <DialogFooter>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              Back
            </Button>
            <Button onClick={save} disabled={busy || !area}>
              {busy ? "Saving…" : "Save photo"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
