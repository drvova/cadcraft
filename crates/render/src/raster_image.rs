//! Raster images: bounded decoding and a process-wide cache.
//!
//! A drawing's `Image` entities reference their file by path; the display list carries decoded
//! pixels ([`ImageData`]) so the canvas and the rasteriser can draw them. Decoding a photo on
//! every rebuild would be far too slow, so results are cached by (path, modified time, length)
//! and shared as `Arc<ImageData>`.
//!
//! Every failure — a missing file, an unsupported format, a hostile size — is simply "no
//! pixels": the frame still draws, nothing panics (the never-crash standard). Reads are capped
//! before the format is known, so a planted endless device or a huge file cannot exhaust memory
//! (CWE-400), and the decoder's own limits refuse absurd dimensions before allocating.

use std::sync::{Arc, Mutex, OnceLock};

/// Most bytes read from one image file before decoding.
pub const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
/// Largest accepted side of a decoded image (matching the rasteriser's own cap).
pub const MAX_IMAGE_SIDE: u32 = 16_384;
/// Largest accepted pixel count of a decoded image.
pub const MAX_IMAGE_PIXELS: u64 = 64 * 1024 * 1024;
/// Decoded images kept before the cache is emptied.
const MAX_CACHE: usize = 64;

/// Decoded RGBA8 pixels, straight (not premultiplied), row-major, top row first.
#[derive(Clone)]
pub struct ImageData {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    /// A premultiplied copy for the rasteriser, made once on first use.
    premultiplied: OnceLock<Vec<u8>>,
}

impl ImageData {
    /// `rgba` must hold exactly `width × height` RGBA pixels; otherwise `None`.
    pub fn new(width: u32, height: u32, rgba: Vec<u8>) -> Option<ImageData> {
        let want = u64::from(width) * u64::from(height) * 4;
        if width == 0 || height == 0 || u64::try_from(rgba.len()).ok() != Some(want) {
            return None;
        }
        Some(ImageData { width, height, rgba, premultiplied: OnceLock::new() })
    }

    /// The straight RGBA pixel at `(x, y)`, or `None` outside the image.
    pub fn pixel(&self, x: u32, y: u32) -> Option<[u8; 4]> {
        if x >= self.width || y >= self.height {
            return None;
        }
        let i = ((u64::from(y) * u64::from(self.width) + u64::from(x)) * 4) as usize;
        let p = self.rgba.get(i..i + 4)?;
        Some([p[0], p[1], p[2], p[3]])
    }

    /// The premultiplied RGBA bytes (for `tiny_skia::Pixmap::from_vec`), computed once.
    pub fn premultiplied(&self) -> &[u8] {
        self.premultiplied.get_or_init(|| {
            let mut out = self.rgba.clone();
            for p in out.as_chunks_mut::<4>().0 {
                let a = u32::from(p[3]);
                p[0] = ((u32::from(p[0]) * a + 127) / 255) as u8;
                p[1] = ((u32::from(p[1]) * a + 127) / 255) as u8;
                p[2] = ((u32::from(p[2]) * a + 127) / 255) as u8;
            }
            out
        })
    }
}

impl std::fmt::Debug for ImageData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ImageData").field("width", &self.width).field("height", &self.height).field("bytes", &self.rgba.len()).finish()
    }
}

/// The cache key: a changed file (different modified time or length) decodes again, and an image
/// drawn with different brightness or contrast is a different entry.
#[derive(Clone, PartialEq, Eq, Hash)]
struct Key {
    path: String,
    modified: Option<u64>,
    len: u64,
    /// The brightness and contrast the pixels were adjusted with (50, 50 = as the file is).
    adjust: (u8, u8),
}

/// The decoded-image cache: `(path, modified time, length)` → pixels.
static CACHE: std::sync::LazyLock<Mutex<std::collections::HashMap<Key, Arc<ImageData>>>> = std::sync::LazyLock::new(Default::default);

/// Forget every cached image (tests; also useful after replacing files in place).
pub fn clear_cache() {
    if let Ok(mut c) = CACHE.lock() {
        c.clear();
    }
}

/// Load and decode the image at `path` exactly as the file is, through the cache. `None` for
/// anything that cannot be read and decoded (the caller draws the frame only).
#[must_use]
pub fn load(path: &str) -> Option<Arc<ImageData>> {
    load_adjusted(path, 50, 50)
}

/// Like [`load`], with the image's brightness and contrast applied (0..=100 each, 50 = as the
/// file is; the values an IMAGE entity carries).
#[must_use]
pub fn load_adjusted(path: &str, brightness: u8, contrast: u8) -> Option<Arc<ImageData>> {
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (path, brightness, contrast);
        None
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let meta = std::fs::metadata(path).ok()?;
        if !meta.is_file() || meta.len() > MAX_IMAGE_BYTES {
            return None;
        }
        let adjust = (brightness.min(100), contrast.min(100));
        let key = Key {
            path: path.to_string(),
            modified: meta.modified().ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos() as u64),
            len: meta.len(),
            adjust,
        };
        if let Ok(c) = CACHE.lock()
            && let Some(hit) = c.get(&key)
        {
            return Some(hit.clone());
        }
        let bytes = read_capped(path, MAX_IMAGE_BYTES)?;
        let mut data = decode(&bytes)?;
        if adjust != (50, 50) {
            adjust_pixels(&mut data.rgba, adjust.0, adjust.1);
        }
        let data = Arc::new(data);
        if let Ok(mut c) = CACHE.lock() {
            if c.len() >= MAX_CACHE {
                c.clear();
            }
            c.insert(key, data.clone());
        }
        Some(data)
    }
}

/// Apply brightness and contrast (0..=100, 50 = unchanged) to RGBA bytes in place. Brightness
/// scales towards white or black; contrast spreads the values around mid-grey. Alpha is left
/// alone.
fn adjust_pixels(rgba: &mut [u8], brightness: u8, contrast: u8) {
    // 0 → ×0, 50 → ×1, 100 → ×2.
    let bright = f32::from(brightness.min(100)) / 50.0;
    let contrast = f32::from(contrast.min(100)) / 50.0;
    let table: [u8; 256] = std::array::from_fn(|i| {
        let v = (i as f32 - 127.5) * contrast + 127.5;
        let v = v * bright;
        v.clamp(0.0, 255.0) as u8
    });
    for p in rgba.as_chunks_mut::<4>().0 {
        p[0] = table[usize::from(p[0])];
        p[1] = table[usize::from(p[1])];
        p[2] = table[usize::from(p[2])];
    }
}

/// Decode bytes as PNG or JPEG under the same limits as [`load`], without the file cache: an
/// image that arrived as base64 `data` rather than as a path.
#[must_use]
pub fn decode_bytes(bytes: &[u8]) -> Option<ImageData> {
    decode(bytes)
}

/// Read at most `max` bytes from a regular file, so a device that never ends cannot exhaust
/// memory before the size check.
#[cfg(not(target_arch = "wasm32"))]
fn read_capped(path: &str, max: u64) -> Option<Vec<u8>> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    file.take(max + 1).read_to_end(&mut buf).ok()?;
    if buf.len() as u64 > max { None } else { Some(buf) }
}

/// Decode bytes as PNG or JPEG (the formats the workspace enables) under the size limits.
fn decode(bytes: &[u8]) -> Option<ImageData> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_SIDE);
    limits.max_image_height = Some(MAX_IMAGE_SIDE);
    limits.max_alloc = Some(MAX_IMAGE_PIXELS * 4 + (1 << 20));
    reader.limits(limits);
    let img = reader.decode().ok()?.to_rgba8();
    let (w, h) = (img.width(), img.height());
    if u64::from(w) * u64::from(h) > MAX_IMAGE_PIXELS {
        return None;
    }
    ImageData::new(w, h, img.into_raw())
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    /// A small PNG with a known pixel at (1, 0).
    #[expect(clippy::unwrap_used, reason = "a fixture that cannot be written is a broken test")]
    fn write_png(path: &std::path::Path, w: u32, h: u32, fill: [u8; 4]) {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba(fill));
        img.save_with_format(path, image::ImageFormat::Png).unwrap();
    }

    fn temp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("cadcraft-image-{}-{name}", std::process::id()))
    }

    #[test]
    fn loads_a_png_and_caches_it() {
        let path = temp("load.png");
        write_png(&path, 4, 3, [200, 100, 50, 255]);
        clear_cache();
        let a = load(path.to_str().unwrap()).expect("decodes");
        assert_eq!((a.width, a.height), (4, 3));
        assert_eq!(a.pixel(1, 2), Some([200, 100, 50, 255]));
        assert_eq!(a.pixel(4, 0), None);
        // A second load is the same shared decode.
        let b = load(path.to_str().unwrap()).expect("cached");
        assert!(Arc::ptr_eq(&a, &b));
        // The premultiplied copy is made once and equals the pixel math.
        let pm = a.premultiplied();
        assert_eq!(&pm[0..4], &[((200 * 255 + 127) / 255) as u8, ((100 * 255 + 127) / 255) as u8, ((50 * 255 + 127) / 255) as u8, 255]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_missing_or_non_image_file_is_no_pixels() {
        clear_cache();
        assert!(load(temp("does-not-exist.png").to_str().unwrap()).is_none());
        let path = temp("text.txt");
        std::fs::write(&path, b"not an image at all").unwrap();
        assert!(load(path.to_str().unwrap()).is_none());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_replaced_file_decodes_again() {
        let path = temp("replace.png");
        write_png(&path, 2, 2, [10, 10, 10, 255]);
        clear_cache();
        let a = load(path.to_str().unwrap()).unwrap();
        assert_eq!(a.pixel(0, 0), Some([10, 10, 10, 255]));
        // Same length, new content: the modified time keys the cache, so the file is read again.
        std::thread::sleep(std::time::Duration::from_millis(20));
        write_png(&path, 2, 2, [250, 20, 20, 255]);
        let b = load(path.to_str().unwrap()).unwrap();
        assert_eq!(b.pixel(0, 0), Some([250, 20, 20, 255]));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn absurd_dimensions_are_refused_without_allocating_them() {
        // 20000 × 1 is one row of pixels: cheap to write, over the side limit, so refused.
        let path = temp("wide.png");
        write_png(&path, 20_000, 1, [0, 0, 0, 255]);
        clear_cache();
        assert!(load(path.to_str().unwrap()).is_none());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn image_data_validates_its_buffer() {
        assert!(ImageData::new(2, 2, vec![0; 16]).is_some());
        assert!(ImageData::new(2, 2, vec![0; 15]).is_none());
        assert!(ImageData::new(0, 2, Vec::new()).is_none());
    }
}
