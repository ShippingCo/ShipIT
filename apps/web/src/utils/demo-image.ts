/**
 * Downscales a picked image and returns it as a JPEG data URL.
 *
 * Counter staff photograph parcels on whatever phone is behind the till, and a modern
 * phone camera produces several megabytes per shot. The whole app persists into
 * localStorage, which is a handful of megabytes in total, so a full-size photo would
 * fill the quota after a few bookings. Downscaling on the way in is what makes
 * attachments survivable at all.
 */
export function downscaleImage(file: Blob, maxW = 720, quality = 0.68): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * sc);
      c.height = Math.round(img.height * sc);
      const ctx = c.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('Canvas 2D context unavailable')); return; }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}
