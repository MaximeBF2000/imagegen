import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import { crc32 } from 'node:zlib';

export interface ZipEntry {
  name: string;
  /** File on disk, or in-memory content. */
  path?: string;
  data?: Buffer;
  mtime?: Date;
}

/**
 * Minimal streaming ZIP writer ("stored" entries, no compression: images are
 * already compressed). Entries are read one at a time, so memory stays flat.
 */
export async function writeZip(out: Writable, entries: ZipEntry[]) {
  const central: Buffer[] = [];
  let offset = 0;

  const write = async (buf: Buffer) => {
    offset += buf.length;
    if (!out.write(buf)) await once(out, 'drain');
  };

  for (const entry of entries) {
    const data = entry.data ?? (await readFile(entry.path!));
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(data);
    const { time, date } = dosTime(entry.mtime ?? new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42); // local header offset (other fields zero)
    central.push(header, name);

    await write(local);
    await write(name);
    await write(data);
  }

  const cdStart = offset;
  const cd = Buffer.concat(central);
  await write(cd);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(cdStart, 16);
  await write(end);
  out.end();
}

function dosTime(d: Date) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function slugify(text: string, words = 8, max = 60) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, words)
    .join('-')
    .slice(0, max);
}
