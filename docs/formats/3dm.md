# The Rhino `.3dm` file: what CADCraft reads and writes

Status: written 2026-11-14 for the first reader (`crates/io/src/rhino3dm/`). This note is the
**only** source the reader and the test writer were written from. It is in our own words: facts
about the byte layout (field orders, sizes, typecodes, class ids), learned by reading McNeel's
openNURBS toolkit (https://github.com/mcneel/opennurbs, branch `8.x`) as documentation — see
`docs/adr/0003-3dm.md` for the licence finding and the list of files read. No code, comment or
identifier of openNURBS is reproduced beyond the format's own names (typecode names such as
`TCODE_OBJECT_TABLE`, kept so the note can be checked against the source).

"[archive]" = learned from `opennurbs_archive.cpp`/`.h`; "[3dm.h]" = `opennurbs_3dm.h`; other
brackets name the file.

## 1. Primitives

All numbers are **little-endian**. `i32`/`u32` 4 bytes, `i16`/`u16` 2, `f32` 4, `f64` 8,
`u8` 1. [archive]

| Name | Layout |
|---|---|
| bool | one byte, 0 or 1 |
| chunk version | one byte: `major * 16 + minor` (high nibble major, low nibble minor) |
| uuid | `u32` data1, `u16` data2, `u16` data3, then 8 bytes as they appear in the text form (`XXXXXXXX-XXXX-XXXX-[8 bytes]`) |
| colour | 4 bytes red, green, blue, then **transparency** (0 = opaque, 255 = clear; old files sometimes wrote 255 for opaque — readers before archive 70 treat 255 as 0) |
| point | 3 × `f64`; interval 2 × `f64`; bounding box = min point, max point |
| plane | origin point, x axis, y axis, z axis (each 3 × `f64`), then the plane equation 4 × `f64` |
| circle | plane, radius `f64`, then three points on it (at 0, π/2, π) which a reader discards |
| arc | circle, then the angle interval in radians (start, end) measured in the plane from its x axis |
| line | from point, to point |
| wide string | `u32` count of UTF-16 code units **including the trailing 0**, then that many `u16`; count 0 = empty string |
| double array | `i32` count, then count × `f64`; point array = `i32` count, then count × 3 `f64` |
| compressed buffer | see §5 |

## 2. File start [archive: start section, end mark]

1. 32 ASCII bytes: `"3D Geometry File Format "` (24 bytes) and the **archive version**
   right-aligned in 8 bytes with leading spaces, e.g. `"      70"`. Versions: 1–4 (old), 5 →
   written as 50, then 60, 70 (Rhino 7), 80 (Rhino 8). A writer accepts 2, 3, 4 and multiples of
   10 from 50. A reader may find the 32 bytes after some leading "goo" (an old OLE wrapper); the
   toolkit searches up to 32 MiB for the signature. CADCraft requires it at offset 0.
2. Immediately after: one long chunk `TCODE_COMMENTBLOCK` (1) holding free text (the writing
   application; it ends with a ^Z and a 0 byte). Not a CRC chunk.
3. Then the tables (§4), and last the end mark (§6).

## 3. Chunks [archive: chunk begin/end, chunk value, big-chunk push] [3dm.h]

Every structure is a chunk: `u32 typecode` then a **value**, 4 bytes (`i32`) for archive
version < 50 and 8 bytes (`i64`) for 50 and later.

- **Short chunk**: typecode has bit `0x80000000` (`TCODE_SHORT`). The value *is* the data; nothing
  follows.
- **Long chunk**: no short bit. The value is the **byte length of the content that follows**
  (not counting the typecode and value). In a 4-byte-length file a long chunk's value is read
  unsigned.
- **CRC**: a long chunk whose typecode has bit `0x8000` (`TCODE_CRC`) ends with a 4-byte CRC-32
  (the zlib/IEEE polynomial, initial value 0 as zlib's `crc32(0, …)`), **included in the length**.
  The CRC covers only the bytes written directly in that chunk — **not** the bytes of chunks
  nested inside it (the running CRC belongs to the innermost open chunk), and not the chunk's
  own header. A chunk that only holds nested chunks therefore has CRC 0 (the CRC of nothing).
  (Archive version 1 used 16-bit CRCs on some legacy typecodes; not supported.)
- A reader that stops early inside a chunk seeks to its end (start of content + length): newer
  writers append fields that older readers skip this way. Unknown chunks are skipped the same way.
- Typecode bits group the meaning: `0x10000000` table, `0x20000000` table record, `0x02000000`
  interface, `0x00020000` openNURBS object, `0x40000000` user.

Typecodes used here:

| Name | Value |
|---|---|
| `TCODE_COMMENTBLOCK` | `0x00000001` |
| `TCODE_ENDOFFILE` | `0x00007FFF` |
| `TCODE_ENDOFTABLE` | `0xFFFFFFFF` (short) |
| `TCODE_PROPERTIES_TABLE` | `0x10000014` |
| `TCODE_SETTINGS_TABLE` | `0x10000015` |
| `TCODE_BITMAP_TABLE` … `TCODE_HISTORYRECORD_TABLE` | `0x10000016`, material `0x10000010`, layer `0x10000011`, light `0x10000012`, object `0x10000013`, user `0x10000017`, group `0x10000018`, font `0x10000019`, dimstyle `0x10000020`, instance definition `0x10000021`, hatch pattern `0x10000022`, linetype `0x10000023`, texture mapping `0x10000025`, history `0x10000026` |
| `TCODE_PROPERTIES_OPENNURBS_VERSION` | `0xA0000026` (short; value = the writing toolkit's version number) |
| `TCODE_LAYER_RECORD` | `0x20008050` |
| `TCODE_OBJECT_RECORD` | `0x20008070` |
| `TCODE_OBJECT_RECORD_TYPE` | `0x82000071` (short; value = object type, below) |
| `TCODE_OBJECT_RECORD_ATTRIBUTES` | `0x02008072` |
| `TCODE_OBJECT_RECORD_ATTRIBUTES_USERDATA` | `0x02000073` |
| `TCODE_OBJECT_RECORD_END` | `0x8200007F` (short) |
| `TCODE_OPENNURBS_CLASS` | `0x00027FFA` |
| `TCODE_OPENNURBS_CLASS_UUID` | `0x0002FFFB` |
| `TCODE_OPENNURBS_CLASS_DATA` | `0x0002FFFC` |
| `TCODE_OPENNURBS_CLASS_USERDATA` | `0x00027FFD` |
| `TCODE_OPENNURBS_CLASS_END` | `0x80027FFF` (short) |
| `TCODE_ANONYMOUS_CHUNK` | `0x40008000` |

Object types (the `TCODE_OBJECT_RECORD_TYPE` value) [`opennurbs_defines.h`]: point 1, curve 4,
surface 8, brep 0x10, mesh 0x20, extrusion 0x40000000, SubD 0x40000.

## 4. Tables [archive: table begin/end, properties, settings, layer, object] [`opennurbs_extensions.cpp`: model write order]

A table is one long chunk with a table typecode; its content is a sequence of record chunks
ended by a short `TCODE_ENDOFTABLE` chunk (value 0). The toolkit writes, in order: properties,
settings, bitmap, texture mapping, material, linetype, layer, group, font (old), dimstyle,
light, hatch pattern, instance definition, object, history record, user tables, then the end
mark. A reader can walk the top-level chunks in any order and skip the tables it does not use.

**Properties** (`TCODE_PROPERTIES_TABLE`): first a short `TCODE_PROPERTIES_OPENNURBS_VERSION`
chunk, then optional records (file name, revision history, notes, preview image, application),
then `TCODE_ENDOFTABLE`. The openNURBS version matters: object attributes (below) use the
"version 5" layout when the archive version ≥ 5 **and** this number ≥ 200712190. Numbers in the
old form are `((yyyy·100 + mm)·100 + dd)·10 + major`.

**Settings** (`TCODE_SETTINGS_TABLE`): records for units, tolerances, views…, ended by
`TCODE_ENDOFTABLE`. CADCraft reads one: `TCODE_SETTINGS_UNITSANDTOLS` (`0x20008031`, a CRC
chunk), the **model units** [`opennurbs_3dm_settings.cpp`]: `i32` layout version (100–199),
`i32` unit system, `f64` absolute tolerance, `f64` angle tolerance (radians), `f64` relative
tolerance; version ≥ 101: `i32` distance display mode, `i32` display precision; ≥ 102: `f64`
metres per unit, wide string custom unit name (only for custom units). Unit system codes
[`opennurbs_defines.h`]: 0 none, 1 microns, 2 millimetres, 3 centimetres, 4 metres, 5
kilometres, 6 micro-inches, 7 mils, 8 inches, 9 feet, 10 miles, 11 custom (use the metres per
unit), 13 nanometres, 14 decimetres; others are rarer metric and imperial units, for which the
metres-per-unit field is used.

**Layer table**: each record is a `TCODE_LAYER_RECORD` chunk holding one openNURBS object
(§4.1) of class layer. Layer data [`opennurbs_layer.cpp`], after its chunk version (1.x):
`i32` mode (0 normal, 1 hidden, 2 locked), `i32` index, `i32` IGES level, `i32` render material
index, `i32` obsolete (0), colour, `i16`, `i16`, `f64`, `f64` (an obsolete line style), wide
string **name**; minor ≥ 1: bool visible; ≥ 2: `i32` linetype index; ≥ 3: plot colour, `f64`
plot weight; ≥ 4: bool locked; ≥ 5: uuid layer id; later minors add more (parent id, expanded,
rendering attributes …) which a reader skips by the chunk boundary. Objects refer to layers by
**index** (the record's position, normally equal to the stored index).

**Object table**: each record is a `TCODE_OBJECT_RECORD` chunk containing, in order: short
`TCODE_OBJECT_RECORD_TYPE`; the geometry as an openNURBS object (§4.1);
`TCODE_OBJECT_RECORD_ATTRIBUTES` (§4.2); optionally attribute user data and history chunks;
short `TCODE_OBJECT_RECORD_END`.

### 4.1 An openNURBS object [archive: object write/read]

A long `TCODE_OPENNURBS_CLASS` chunk holding: `TCODE_OPENNURBS_CLASS_UUID` (16-byte class id
+ CRC), `TCODE_OPENNURBS_CLASS_DATA` (the class's own data, §5–§7, + CRC), optionally
`TCODE_OPENNURBS_CLASS_USERDATA` chunks, then short `TCODE_OPENNURBS_CLASS_END`.

Class ids (text form) [the class's `.cpp`]:

| Class | Id |
|---|---|
| layer | `95809813-E985-11d3-BFE5-0010830122F0` |
| mesh | `4ED7D4E4-E947-11d3-BFE5-0010830122F0` |
| NURBS curve | `4ED7D4DD-E947-11d3-BFE5-0010830122F0` |
| polyline curve | `4ED7D4E6-E947-11d3-BFE5-0010830122F0` |
| line curve | `4ED7D4DB-E947-11d3-BFE5-0010830122F0` |
| arc curve | `CF33BE2A-09B4-11d4-BFFB-0010830122F0` |
| poly curve | `4ED7D4E0-E947-11d3-BFE5-0010830122F0` |
| point | `C3101A1D-F157-11d3-BFE7-0010830122F0` |
| NURBS surface | `4ED7D4DE-E947-11d3-BFE5-0010830122F0` |
| brep | `60B5DBC5-E660-11d3-BFE4-0010830122F0` |
| extrusion | `36F53175-72B8-4d47-BF1F-B4E6FC24F4B9` |
| SubD | `F09BA4D9-455B-42C3-BA3B-E6CCACEF853B` |

### 4.2 Object attributes [`opennurbs_3dm_attributes.cpp`]

Version-5 layout (archive ≥ 5 and toolkit ≥ 200712190): chunk version with **major 2**, uuid
object id, `i32` layer index, then a stream of `(u8 item id, value)` pairs ended by item 0. Only
non-default items are written, in increasing id order. Item 1 = wide string **name**, 2 = wide
string URL, 3 = `i32` linetype index, 4 = `i32` material index, 5 = rendering attributes (a
structure — the reader stops here), 6 = colour, 7 = plot colour, 8 = `f64` plot weight, 9 = `u8`
decoration, 10 = `i32` wire density, 11 = bool visible, 12 = `u8` mode, 13 = `u8` colour source, …
A reader that only needs the name and layer stops at the first item it does not take; the chunk
boundary covers the rest.

The two layouts differ in their chunk version's major number (2 or 1), so CADCraft's reader
picks the layout from that byte rather than from the toolkit number.

Older layout (major 1): uuid, `i32` layer, `i32` material, colour, `i16`, `i16`, `f64`, `f64`,
`i32` wire density, 4 × `u8` (mode, colour/linetype/material sources), wide string name, wide
string URL, then minor-gated fields.

## 5. Compressed buffers [`opennurbs_zlib.cpp`]

`u32` uncompressed size; if 0, nothing more. Otherwise `u32` CRC-32 of the **uncompressed**
bytes, `u8` method: 0 = the bytes follow raw (size bytes); 1 = a long `TCODE_ANONYMOUS_CHUNK`
holding a **zlib stream** (RFC 1950, deflate inside) plus that chunk's own 4-byte CRC. The
toolkit stores small buffers (≤ 128 bytes) raw.

## 6. End mark [archive]

A long `TCODE_ENDOFFILE` chunk whose length is 4 (archive < 50) or 8, holding the total file
size in bytes (`u32` or `u64`), counting the end mark itself.

## 7. Geometry

### Mesh [`opennurbs_mesh.cpp`]

Chunk version **3.x** (minor 5 for archive 50, 8 for 60+). Then: `i32` vertex count V, `i32`
face count F, 4 intervals (packed texture domain u, v; surface domain u, v), 2 × `f64` surface
scale, 6 × `f32` vertex box (legacy), 6 × `f32` normal box, 4 × `f32` texture box, `i32` closed
flag (−1 unknown, 0 open, 1 closed), `u8` has-mesh-parameters (if 1: an anonymous chunk), 4 ×
(`u8` has-curvature-stats, if 1 an anonymous chunk), then the **face array**: `i32` index size
(1, 2 or 4: bytes per index, chosen by the writer from V < 256, < 65536, else) and F × 4 indices
(a **triangle repeats its third index in the fourth**; a quad's four differ), then five
compressed buffers (§5) for: vertices (V × 3 `f32`), normals (V × 3 `f32` or empty), texture
coordinates (V × 2 `f32` or empty), curvatures (V × 2 `f64` or empty), colours (V × 4 bytes or
empty). Then (minor ≥ 2) `i32` packed-texture-rotate, (≥ 3) uuid texture mapping id, a
compressed buffer of surface parameters (V × 2 `f64` or empty, only if V > 0), (≥ 4) a mapping
tag in an anonymous chunk with its own major/minor (`TCODE_ANONYMOUS_CHUNK` whose content starts
`i32` 1, `i32` 1, then uuid, `u32` CRC, 16 × `f64` transform, `u32` mapping type), (≥ 5) 3 × `u8`
manifold/oriented/solid flags, (≥ 6) bool has-ngons (+ ngons), (≥ 7) bool has-double-vertices
(+ them), (≥ 8) bounding box (6 × `f64`). CADCraft reads up to the normals and the face array;
it uses the single-precision vertices.

### Curves

- **Line curve**: chunk version 1.0, line, interval domain, `i32` dimension. [`opennurbs_linecurve.cpp`]
- **Arc curve** (circles are full arcs, 0..2π): chunk version 1.0, arc, interval domain, `i32`
  dimension. [`opennurbs_arccurve.cpp`]
- **Polyline curve**: chunk version 1.0, point array, double array of parameters (one per
  point), `i32` dimension. [`opennurbs_polylinecurve.cpp`]
- **NURBS curve**: chunk version 1.x (minor 1 from archive 60), `i32` dimension, `i32` rational
  (0/1), `i32` **order** (degree + 1), `i32` control point count N, two `i32` reserved, a
  bounding box (not meaningful), `i32` knot count then the knots — **N + order − 2 knots**
  (openNURBS omits the two superfluous end knots of the textbook vector) — `i32` control point
  count then N × (dimension + rational) `f64`; rational points are **homogeneous** (x·w, y·w,
  z·w, w). Minor ≥ 1 adds one bool (a SubD-friendly tag). [`opennurbs_nurbscurve.cpp`]
- **Poly curve** (joined segments): chunk version 1.0, `i32` segment count, two `i32` reserved,
  bounding box, double array of segment parameters (count + 1), then each segment as an
  openNURBS object (§4.1) — so poly curves nest. [`opennurbs_polycurve.cpp`]

## 8. Not covered

NURBS surfaces, breps (trimmed surfaces with topology), extrusions, SubD, annotations, blocks
(instance definitions/references), materials, user data and history: their records are
recognised by class id (or skipped as unknown) and reported, never parsed.
