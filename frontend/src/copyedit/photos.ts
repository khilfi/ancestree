/**
 * Photos and story pictures in a copy to edit, made in the browser as
 * backend/src/ancestree/media/photos.py makes them in the app: turned upright, the avatars cut
 * from the chosen square at 512 and 128 pixels, and a copy to show at most 1,600 pixels on each
 * side, all WebP. The app makes its own from the shown copy when the copy comes back.
 */

/** The kept square, in percent of the upright photo (react-easy-crop's `croppedArea`). */
export type Crop = { x: number; y: number; width: number; height: number };

export const AVATAR_SIZES = [512, 128] as const;
export const DISPLAY_SIZE = 1600;
const QUALITY = 0.85;

/** A photo the browser can't read, or can't make a picture from. */
export class PhotoProblem extends Error {}

export type MadePhoto = {
  crop: Crop;
  avatars: Record<(typeof AVATAR_SIZES)[number], string>; // data: addresses
  display: string;
};

/** Python's round(): halves go to the even neighbour. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const rest = value - floor;
  if (rest < 0.5) return floor;
  if (rest > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function centredSquare(width: number, height: number): Crop {
  const side = Math.min(width, height);
  return {
    x: ((width - side) / 2 / width) * 100,
    y: ((height - side) / 2 / height) * 100,
    width: (side / width) * 100,
    height: (side / height) * 100,
  };
}

/** The crop in pixels, forced square and kept inside the photo (media/photos.py crop_box). */
export function cropBox(width: number, height: number, crop: Crop): [number, number, number] {
  const left = Math.min(roundHalfEven((crop.x / 100) * width), width - 1);
  const top = Math.min(roundHalfEven((crop.y / 100) * height), height - 1);
  let side = roundHalfEven(Math.min((crop.width / 100) * width, (crop.height / 100) * height));
  side = Math.max(1, Math.min(side, width - left, height - top));
  return [left, top, side];
}

export function validCrop(crop: unknown): crop is Crop {
  if (!crop || typeof crop !== "object") return false;
  const { x, y, width, height } = crop as Record<string, unknown>;
  const within = (value: unknown, low: number, open: boolean) =>
    typeof value === "number" && (open ? value > low : value >= low) && value <= 100;
  return (
    within(x, 0, false) && within(y, 0, false) && within(width, 0, true) && within(height, 0, true)
  );
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoProblem(
      "That file isn't a photo this browser can read. Use a JPEG, PNG or WebP photo.",
    );
  }
}

function canvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

async function encode(surface: OffscreenCanvas | HTMLCanvasElement): Promise<string> {
  const blob =
    surface instanceof HTMLCanvasElement
      ? await new Promise<Blob | null>((resolve) => surface.toBlob(resolve, "image/webp", QUALITY))
      : await surface.convertToBlob({ type: "image/webp", quality: QUALITY });
  if (!blob) throw new PhotoProblem("The photo couldn't be made smaller.");
  return dataAddress(blob);
}

/** A file as a data: address, to keep in the copy. */
export function dataAddress(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function draw(
  image: ImageBitmap,
  box: [number, number, number, number],
  width: number,
  height: number,
) {
  const surface = canvas(width, height);
  const context = surface.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, box[0], box[1], box[2], box[3], 0, 0, width, height);
  return surface;
}

/** A shown copy at most `DISPLAY_SIZE` on each side (Pillow's thumbnail). */
async function shown(image: ImageBitmap): Promise<string> {
  const scale = Math.min(1, DISPLAY_SIZE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  return encode(draw(image, [0, 0, image.width, image.height], width, height));
}

/** Upright, cropped (a centred square unless chosen), the avatars and the shown copy. */
export async function makePhoto(file: Blob, crop: Crop | null): Promise<MadePhoto> {
  const image = await decode(file);
  try {
    const kept = crop ?? centredSquare(image.width, image.height);
    const [left, top, side] = cropBox(image.width, image.height, kept);
    const avatars = {} as MadePhoto["avatars"];
    for (const size of AVATAR_SIZES) {
      avatars[size] = await encode(draw(image, [left, top, side, side], size, size));
    }
    return { crop: kept, avatars, display: await shown(image) };
  } finally {
    image.close();
  }
}

/** A picture for a life story: upright, at most `DISPLAY_SIZE` on each side, WebP. */
export async function makePicture(file: Blob): Promise<string> {
  const image = await decode(file);
  try {
    return await shown(image);
  } finally {
    image.close();
  }
}

/** A data: address back as a file. */
export function blobOf(address: string): Blob | null {
  const match = address.match(/^data:([^;,]+);base64,(.*)$/);
  if (!match?.[1] || match[2] === undefined) return null;
  const text = atob(match[2]);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}
