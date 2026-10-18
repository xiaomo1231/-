"""
Makes a SoundFont playable by alphaTab: its synthesizer only plays samples marked
mono (sampleType bit 1) and skips stereo left/right ones, so most instruments of
MuseScore General / FluidR3 would be silent. Each left/right sample is re-marked
as mono; the instrument zones already pan them left and right, so the stereo image
stays. Ogg-compressed samples (SF3, bit 0x10) keep that bit; ROM samples are left alone.

    python scripts/patch-soundfont.py <in.sf2|sf3> <out>
"""
import struct
import sys

LEFT, RIGHT, MONO, OGG, ROM = 4, 2, 1, 0x10, 0x8000


def find_shdr(buf: bytearray) -> tuple[int, int]:
    """Offset and size of the 'shdr' chunk inside the RIFF's pdta list."""
    if buf[0:4] != b'RIFF' or buf[8:12] != b'sfbk':
        raise SystemExit('not a SoundFont (RIFF sfbk) file')
    pos = 12
    while pos + 8 <= len(buf):
        cid, size = buf[pos:pos + 4], struct.unpack_from('<I', buf, pos + 4)[0]
        if cid == b'LIST' and buf[pos + 8:pos + 12] == b'pdta':
            sub, end = pos + 12, pos + 8 + size
            while sub + 8 <= end:
                sid, ssize = buf[sub:sub + 4], struct.unpack_from('<I', buf, sub + 4)[0]
                if sid == b'shdr':
                    return sub + 8, ssize
                sub += 8 + ssize + (ssize & 1)
        pos += 8 + size + (size & 1)
    raise SystemExit('no shdr chunk found')


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    buf = bytearray(open(src, 'rb').read())
    off, size = find_shdr(buf)
    changed = 0
    for rec in range(off, off + size - 46 + 1, 46):
        t = struct.unpack_from('<H', buf, rec + 44)[0]
        if t & ROM or not (t & (LEFT | RIGHT)):
            continue
        struct.pack_into('<H', buf, rec + 44, (t & OGG) | MONO)
        struct.pack_into('<H', buf, rec + 42, 0)  # sampleLink: no longer a pair
        changed += 1
    open(dst, 'wb').write(buf)
    print(f'{src}: {size // 46} samples, {changed} left/right samples marked mono -> {dst}')


if __name__ == '__main__':
    main()
