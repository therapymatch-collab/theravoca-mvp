// Convert a File into a downscaled JPEG data URL (base64) for storage in MongoDB.
// Caps at 256x256 max dimension and ~80% JPEG quality. Returns null if image
// load fails. Throws if the resulting payload would exceed sizeLimitBytes.
export async function imageToDataUrl(file, sizeLimitBytes = 500 * 1024) {
  if (!file) return null;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
  const MAX = 256;
  let { width, height } = img;
  if (width > MAX || height > MAX) {
    const scale = Math.min(MAX / width, MAX / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  const out = canvas.toDataURL("image/jpeg", 0.8);
  if (out.length > sizeLimitBytes) {
    throw new Error(
      `Image too large after resize (${Math.round(out.length / 1024)}KB). Try a smaller photo.`,
    );
  }
  return out;
}
