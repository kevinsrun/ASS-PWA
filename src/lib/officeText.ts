import { inflateRawSync } from "zlib";

type ZipEntry = { name: string; compression: number; compressedSize: number; localOffset: number };

function entries(buffer: Buffer) {
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("Office document is not a valid ZIP archive");
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const result: ZipEntry[] = [];
  for (let index = 0; index < total; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Office ZIP directory is invalid");
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    result.push({
      name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
      compression: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      localOffset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

function readEntry(buffer: Buffer, entry: ZipEntry) {
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(start, start + entry.compressedSize);
  if (entry.compression === 0) return compressed;
  if (entry.compression === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported Office ZIP compression: ${entry.compression}`);
}

function plainXml(xml: string) {
  return xml
    .replace(/<w:tab\/?[^>]*>/g, "\t")
    .replace(/<w:br\/?[^>]*>|<a:br\/?[^>]*>/g, "\n")
    .replace(/<\/w:p>|<\/a:p>|<\/row>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function extractOfficeText(buffer: Buffer, mimeType: string) {
  const zip = entries(buffer);
  let selected: ZipEntry[] = [];
  if (mimeType.includes("wordprocessingml")) {
    selected = zip.filter((entry) => /^word\/(document|header\d*|footer\d*|footnotes)\.xml$/.test(entry.name));
  } else if (mimeType.includes("spreadsheetml")) {
    selected = zip.filter((entry) => entry.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name));
  } else if (mimeType.includes("presentationml")) {
    selected = zip.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name));
  }
  if (!selected.length) throw new Error("No readable content was found in the Office document");
  return selected.map((entry) => plainXml(readEntry(buffer, entry).toString("utf8"))).filter(Boolean).join("\n\n").slice(0, 180_000);
}
