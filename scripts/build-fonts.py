#!/usr/bin/env python3
"""Build browser fonts from the original GRiD .TYP bitmap font objects.

The .TYP files are 8086 OMF objects. Their LEDATA records contain a five-byte
font header followed by a scanline-major bitmap strike:

    glyph count, character width, character height, line height, baseline

Each scanline stores one byte-aligned cell per glyph. The 9x12 and 12x16 faces
store right-aligned glyph bits in two-byte big-endian cells, while the 24x32
face stores three full display-order bytes. GRiD's character table is one-based,
so character code 32 is strike entry 33.
"""

from __future__ import annotations

import argparse
import hashlib
from dataclasses import dataclass
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


PIXEL_UNITS = 64
OPENTYPE_1984_EPOCH = 2_524_608_000
PRINTABLE_ASCII = range(0x20, 0x7F)
GRID_PRIVATE_GLYPHS = {0xE081: 0x81}


@dataclass(frozen=True)
class GridStrike:
    count: int
    width: int
    height: int
    line_height: int
    baseline: int
    rows: tuple[tuple[bytes, ...], ...]

    def pixel(self, codepoint: int, x: int, y: int) -> bool:
        cell = self.rows[y][codepoint + 1]
        if len(cell) >= 3:
            return bool((cell[x // 8] >> (7 - (x % 8))) & 1)

        if len(cell) == 2:
            word = int.from_bytes(cell, "big")
            return bool((word >> (self.width - 1 - x)) & 1)

        return bool((cell[0] >> (7 - x)) & 1)


def read_omf_ledata(path: Path) -> bytes:
    """Reassemble the data segment from 16-bit OMF LEDATA records."""
    source = path.read_bytes()
    offset = 0
    chunks: list[tuple[int, bytes]] = []

    while offset < len(source):
        if offset + 3 > len(source):
            raise ValueError(f"{path}: truncated OMF record header")

        record_type = source[offset]
        record_length = int.from_bytes(source[offset + 1 : offset + 3], "little")
        record_end = offset + 3 + record_length
        if record_end > len(source):
            raise ValueError(f"{path}: truncated OMF record")

        # OMF record_length includes the final checksum byte.
        payload = source[offset + 3 : record_end - 1]
        if record_type == 0xA0:  # LEDATA, 16-bit offset form
            if not payload or payload[0] & 0x80:
                raise ValueError(f"{path}: unsupported two-byte OMF segment index")
            data_offset = int.from_bytes(payload[1:3], "little")
            chunks.append((data_offset, payload[3:]))

        offset = record_end

    if not chunks:
        raise ValueError(f"{path}: no OMF LEDATA records")

    data_size = max(chunk_offset + len(chunk) for chunk_offset, chunk in chunks)
    data = bytearray(data_size)
    for chunk_offset, chunk in chunks:
        data[chunk_offset : chunk_offset + len(chunk)] = chunk
    return bytes(data)


def read_grid_strike(path: Path) -> GridStrike:
    data = read_omf_ledata(path)
    if len(data) < 5:
        raise ValueError(f"{path}: missing GRiD font header")

    count, width, height, line_height, baseline = data[:5]
    # Early TypeGRiD files leave vertical metrics at zero and rely on the
    # Window Manager defaults. Reproduce the 5x8 cell using those defaults.
    if line_height == 0:
        line_height = height
    if baseline == 0:
        baseline = height - 1
    bytes_per_row = (width + 7) // 8
    bitmap_size = count * height * bytes_per_row
    bitmap = data[5 : 5 + bitmap_size]
    padding = data[5 + bitmap_size :]

    if len(bitmap) != bitmap_size:
        raise ValueError(f"{path}: truncated GRiD bitmap strike")
    # The original objects reserve three trailing bytes after the strike. Some
    # faces leave linker-era marker values there, so verify the length without
    # treating the padding as glyph data.
    if len(padding) != 3:
        raise ValueError(f"{path}: unexpected GRiD font trailer length")
    if max(PRINTABLE_ASCII) + 1 >= count:
        raise ValueError(f"{path}: printable ASCII is incomplete")

    rows = []
    cursor = 0
    for _ in range(height):
        scanline = []
        for _ in range(count):
            scanline.append(bytes(bitmap[cursor : cursor + bytes_per_row]))
            cursor += bytes_per_row
        rows.append(tuple(scanline))

    return GridStrike(
        count=count,
        width=width,
        height=height,
        line_height=line_height,
        baseline=baseline,
        rows=tuple(rows),
    )


def glyph_for_code(strike: GridStrike, grid_code: int):
    pen = TTGlyphPen(None)

    # GRiD's Window Manager advances the cursor for a space without drawing
    # the corresponding strike entry.
    if grid_code == 0x20:
        return pen.glyph()

    # One contour per horizontal run preserves the source bitmap precisely and
    # keeps the generated outlines smaller than one contour per lit pixel.
    for y in range(strike.height):
        x = 0
        while x < strike.width:
            if not strike.pixel(grid_code, x, y):
                x += 1
                continue

            run_start = x
            while x < strike.width and strike.pixel(grid_code, x, y):
                x += 1

            x0 = run_start * PIXEL_UNITS
            x1 = x * PIXEL_UNITS
            y1 = (strike.baseline - y) * PIXEL_UNITS
            y0 = y1 - PIXEL_UNITS
            pen.moveTo((x0, y0))
            pen.lineTo((x1, y0))
            pen.lineTo((x1, y1))
            pen.lineTo((x0, y1))
            pen.closePath()

    return pen.glyph()


def build_font(source: Path, output: Path, family: str) -> GridStrike:
    strike = read_grid_strike(source)
    character_map = {codepoint: codepoint for codepoint in PRINTABLE_ASCII}
    character_map.update(
        {
            unicode_codepoint: grid_code
            for unicode_codepoint, grid_code in GRID_PRIVATE_GLYPHS.items()
            if grid_code + 1 < strike.count
        }
    )
    codepoints = list(character_map)
    glyph_names = [f"uni{codepoint:04X}" for codepoint in codepoints]
    glyph_order = [".notdef", *glyph_names]

    pen = TTGlyphPen(None)
    glyphs = {".notdef": pen.glyph()}
    glyphs.update(
        {
            glyph_name: glyph_for_code(strike, character_map[codepoint])
            for glyph_name, codepoint in zip(glyph_names, codepoints, strict=True)
        }
    )

    units_per_em = strike.line_height * PIXEL_UNITS
    ascent = strike.baseline * PIXEL_UNITS
    descent = -(strike.line_height - strike.baseline) * PIXEL_UNITS
    advance = strike.width * PIXEL_UNITS
    metrics = {glyph_name: (advance, 0) for glyph_name in glyph_order}
    cmap = {codepoint: glyph_name for codepoint, glyph_name in zip(codepoints, glyph_names, strict=True)}
    cmap[0x00A0] = "uni0020"

    font = FontBuilder(units_per_em, isTTF=True)
    font.setupGlyphOrder(glyph_order)
    font.setupCharacterMap(cmap)
    font.setupGlyf(glyphs)
    font.setupHorizontalMetrics(metrics)
    font.setupHorizontalHeader(ascent=ascent, descent=descent, lineGap=0)
    font.setupNameTable(
        {
            "familyName": family,
            "styleName": "Regular",
            "uniqueFontIdentifier": f"UA571C.com:{family}:1.0",
            "fullName": family,
            "psName": family.replace(" ", "").replace("×", "x"),
            "version": "Version 1.0; converted from original GRiD bitmap data",
        }
    )
    font.setupOS2(
        sTypoAscender=ascent,
        sTypoDescender=descent,
        sTypoLineGap=0,
        usWinAscent=max(0, ascent),
        usWinDescent=max(0, -descent),
        sxHeight=max(0, (strike.baseline - 3) * PIXEL_UNITS),
        sCapHeight=max(0, (strike.baseline - 1) * PIXEL_UNITS),
    )
    font.setupPost(isFixedPitch=1)
    font.setupMaxp()

    # FontBuilder otherwise stamps the current time into `head`, which makes a
    # byte-for-byte rebuild impossible. Anchor the conversion to 1984, the year
    # of the source TypeBlock objects.
    font.font.recalcTimestamp = False
    font.font["head"].created = OPENTYPE_1984_EPOCH
    font.font["head"].modified = OPENTYPE_1984_EPOCH

    output.parent.mkdir(parents=True, exist_ok=True)
    font.font.flavor = "woff2"
    font.save(output)
    return strike


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path("assets/fonts/source"),
        help="directory containing the original .TYP objects",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("assets/fonts"),
        help="directory for generated WOFF2 fonts",
    )
    args = parser.parse_args()

    fonts = (
        ("TB9X12.TYP", "grid-typeblock-9x12", "GRiD TypeBlock 9x12"),
        ("TB12X16.TYP", "grid-typeblock-12x16", "GRiD TypeBlock 12x16"),
        ("TB24X32.TYP", "grid-typeblock-24x32", "GRiD TypeBlock 24x32"),
        ("TG5X8.TYP", "grid-typegrid-5x8", "GRiD TypeGRiD 5x8"),
    )

    for source_name, output_stem, family in fonts:
        temporary_output = args.output_dir / f".{output_stem}.woff2"
        strike = build_font(
            args.source_dir / source_name,
            temporary_output,
            family,
        )
        digest = hashlib.sha256(temporary_output.read_bytes()).hexdigest()[:8]
        output_name = f"{output_stem}.{digest}.woff2"
        output_path = args.output_dir / output_name
        temporary_output.replace(output_path)
        print(
            f"{source_name}: {strike.count} glyphs, "
            f"{strike.width}x{strike.height}, line {strike.line_height}, "
            f"baseline {strike.baseline} -> {output_name}"
        )


if __name__ == "__main__":
    main()
