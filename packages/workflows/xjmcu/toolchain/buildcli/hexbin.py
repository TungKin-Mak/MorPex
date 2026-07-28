"""buildcli — Intel HEX → raw binary (.xbin) conversion."""


def hex_to_raw(hex_path: str, rom_words: int, fill: int = 0x3FFF) -> bytes:
    """Parse an Intel HEX file and produce a raw binary padded to *rom_words*.

    Each ROM word is 2 bytes (16-bit), filled with *fill* for unused addresses.
    """
    raw = bytearray(rom_words * 2)
    fill_bytes = fill.to_bytes(2, "little")
    for i in range(0, len(raw), 2):
        raw[i : i + 2] = fill_bytes

    extended_addr = 0

    with open(hex_path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line.startswith(":"):
                continue

            try:
                byte_count  = int(line[1:3], 16)
                addr        = (int(line[3:5], 16) << 8) | int(line[5:7], 16)
                record_type = int(line[7:9], 16)
            except ValueError:
                continue

            data_start = 9
            data_end   = data_start + byte_count * 2

            if record_type == 0x00:
                phys_addr = extended_addr + addr
                data = bytes.fromhex(line[data_start:data_end])
                for j, b in enumerate(data):
                    offset = phys_addr + j
                    if offset < len(raw):
                        raw[offset] = b
            elif record_type == 0x01:
                break
            elif record_type == 0x04:
                extended_addr = int(line[9:13], 16) << 16

    return bytes(raw)
