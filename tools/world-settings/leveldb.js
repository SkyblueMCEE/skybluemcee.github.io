/* Minimal Bedrock LevelDB table support for repairing the local player's
   Creative abilities when a world is converted to Hardcore.

   This deliberately does not try to be a general LevelDB implementation. It
   preserves every existing record and table block, rewrites only
   ~local_player, and fails closed when it encounters an unsupported layout. */

const LDB_FOOTER_SIZE = 48;
const LDB_MAGIC = [0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb];
const LDB_COMPRESSION_NONE = 0;
const LDB_COMPRESSION_RAW_DEFLATE = 4;

const LDB_CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0x82F63B78 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function ldbConcat(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach(part => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function ldbUint32(value) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value >>> 0, true);
  return output;
}

function ldbReadUint32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error("leveldb-layout");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function ldbCrc32c(bytes) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index++) {
    crc = LDB_CRC32C_TABLE[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  }
  return (~crc) >>> 0;
}

function ldbMaskCrc(crc) {
  const rotated = ((crc >>> 15) | (crc << 17)) >>> 0;
  return (rotated + 0xA282EAD8) >>> 0;
}

function ldbReadVarint(bytes, offset) {
  let value = 0;
  let multiplier = 1;
  let position = offset;
  for (; position < bytes.length && position < offset + 10; position++) {
    const byte = bytes[position];
    value += (byte & 0x7F) * multiplier;
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value)) throw new Error("leveldb-layout");
      return { value: value, next: position + 1 };
    }
    multiplier *= 128;
  }
  throw new Error("leveldb-layout");
}

function ldbWriteVarint(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("leveldb-layout");
  const output = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining) byte |= 0x80;
    output.push(byte);
  } while (remaining);
  return Uint8Array.from(output);
}

function ldbReadHandle(bytes, offset) {
  const first = ldbReadVarint(bytes, offset || 0);
  const second = ldbReadVarint(bytes, first.next);
  return { offset: first.value, size: second.value, next: second.next };
}

function ldbWriteHandle(handle) {
  return ldbConcat([ldbWriteVarint(handle.offset), ldbWriteVarint(handle.size)]);
}

function ldbBytesEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function ldbDecodeBlock(raw) {
  if (raw.length < 8) throw new Error("leveldb-layout");
  const restartCount = ldbReadUint32(raw, raw.length - 4);
  const restartStart = raw.length - 4 - restartCount * 4;
  if (restartCount < 1 || restartStart < 0) throw new Error("leveldb-layout");

  const restartOffsets = new Set();
  for (let index = 0; index < restartCount; index++) {
    restartOffsets.add(ldbReadUint32(raw, restartStart + index * 4));
  }

  const entries = [];
  let previousKey = new Uint8Array(0);
  let position = 0;
  while (position < restartStart) {
    const start = position;
    const shared = ldbReadVarint(raw, position);
    const unshared = ldbReadVarint(raw, shared.next);
    const valueLength = ldbReadVarint(raw, unshared.next);
    position = valueLength.next;
    if (shared.value > previousKey.length || position + unshared.value + valueLength.value > restartStart) {
      throw new Error("leveldb-layout");
    }

    const key = new Uint8Array(shared.value + unshared.value);
    key.set(previousKey.subarray(0, shared.value), 0);
    key.set(raw.subarray(position, position + unshared.value), shared.value);
    position += unshared.value;
    const value = raw.slice(position, position + valueLength.value);
    position += valueLength.value;

    entries.push({
      key: key,
      value: value,
      shared: shared.value,
      isRestart: restartOffsets.has(start)
    });
    previousKey = key;
  }
  if (position !== restartStart || !entries.length || !entries[0].isRestart) {
    throw new Error("leveldb-layout");
  }
  return entries;
}

function ldbEncodeBlock(entries) {
  const parts = [];
  const restartOffsets = [];
  let length = 0;
  let previousKey = new Uint8Array(0);

  entries.forEach((entry, index) => {
    let shared = entry.isRestart ? 0 : entry.shared;
    if (index === 0) shared = 0;
    if (shared > previousKey.length || shared > entry.key.length) throw new Error("leveldb-layout");
    for (let keyIndex = 0; keyIndex < shared; keyIndex++) {
      if (previousKey[keyIndex] !== entry.key[keyIndex]) throw new Error("leveldb-layout");
    }
    if (shared === 0) restartOffsets.push(length);

    const suffix = entry.key.subarray(shared);
    const encoded = ldbConcat([
      ldbWriteVarint(shared),
      ldbWriteVarint(suffix.length),
      ldbWriteVarint(entry.value.length),
      suffix,
      entry.value
    ]);
    parts.push(encoded);
    length += encoded.length;
    previousKey = entry.key;
  });

  restartOffsets.forEach(offset => parts.push(ldbUint32(offset)));
  parts.push(ldbUint32(restartOffsets.length));
  return ldbConcat(parts);
}

async function ldbDeflateRaw(bytes) {
  if (typeof CompressionStream !== "function") throw new Error("leveldb-compression");
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function ldbReadBlock(table, handle) {
  if (handle.offset < 0 || handle.size < 0 || handle.offset + handle.size + 5 > table.length - LDB_FOOTER_SIZE) {
    throw new Error("leveldb-layout");
  }
  const packed = table.slice(handle.offset, handle.offset + handle.size);
  const type = table[handle.offset + handle.size];
  const storedCrc = ldbReadUint32(table, handle.offset + handle.size + 1);
  const actualCrc = ldbMaskCrc(ldbCrc32c(ldbConcat([packed, Uint8Array.of(type)])));
  if (storedCrc !== actualCrc) throw new Error("leveldb-checksum");

  let raw;
  if (type === LDB_COMPRESSION_NONE) raw = packed;
  else if (type === LDB_COMPRESSION_RAW_DEFLATE) raw = await inflateRaw(packed);
  else throw new Error("leveldb-compression");
  return { packed: packed, raw: raw, type: type };
}

async function ldbPackBlock(raw, type) {
  let packed;
  if (type === LDB_COMPRESSION_NONE) packed = raw;
  else if (type === LDB_COMPRESSION_RAW_DEFLATE) packed = await ldbDeflateRaw(raw);
  else throw new Error("leveldb-compression");

  const crc = ldbMaskCrc(ldbCrc32c(ldbConcat([packed, Uint8Array.of(type)])));
  return {
    packed: packed,
    bytes: ldbConcat([packed, Uint8Array.of(type), ldbUint32(crc)])
  };
}

function ldbReadSequence(internalKey) {
  if (internalKey.length < 8) throw new Error("leveldb-layout");
  const view = new DataView(internalKey.buffer, internalKey.byteOffset + internalKey.length - 8, 8);
  const tag = view.getBigUint64(0, true);
  return { sequence: tag >> 8n, valueType: Number(tag & 0xFFn) };
}

function ldbIsLocalPlayerKey(internalKey) {
  if (internalKey.length < 8) return false;
  return DEC.decode(internalKey.subarray(0, internalKey.length - 8)) === "~local_player";
}

function ldbReadFooter(table) {
  if (table.length < LDB_FOOTER_SIZE) throw new Error("leveldb-layout");
  const footer = table.subarray(table.length - LDB_FOOTER_SIZE);
  if (!ldbBytesEqual(footer.subarray(40), Uint8Array.from(LDB_MAGIC))) throw new Error("leveldb-layout");
  const meta = ldbReadHandle(footer, 0);
  const index = ldbReadHandle(footer, meta.next);
  if (index.next > 40) throw new Error("leveldb-layout");
  return { bytes: footer, meta: meta, index: index };
}

async function ldbOpenTable(tableBytes) {
  const table = new Uint8Array(tableBytes);
  const footer = ldbReadFooter(table);
  const metaBlock = await ldbReadBlock(table, footer.meta);
  const indexBlock = await ldbReadBlock(table, footer.index);
  const metaEntries = ldbDecodeBlock(metaBlock.raw);
  const indexEntries = ldbDecodeBlock(indexBlock.raw);
  const dataBlocks = [];

  for (let index = 0; index < indexEntries.length; index++) {
    const handle = ldbReadHandle(indexEntries[index].value, 0);
    if (handle.next !== indexEntries[index].value.length) throw new Error("leveldb-layout");
    const block = await ldbReadBlock(table, handle);
    dataBlocks.push({
      index: index,
      handle: handle,
      block: block,
      entries: ldbDecodeBlock(block.raw)
    });
  }

  return {
    table: table,
    footer: footer,
    metaBlock: metaBlock,
    metaEntries: metaEntries,
    indexBlock: indexBlock,
    indexEntries: indexEntries,
    dataBlocks: dataBlocks
  };
}

function ldbFindLocalPlayer(layout) {
  let best = null;
  layout.dataBlocks.forEach(dataBlock => {
    dataBlock.entries.forEach((entry, entryIndex) => {
      if (!ldbIsLocalPlayerKey(entry.key)) return;
      const internal = ldbReadSequence(entry.key);
      if (internal.valueType === 0) return;
      if (!best || internal.sequence > best.sequence) {
        best = {
          sequence: internal.sequence,
          dataBlock: dataBlock,
          entryIndex: entryIndex,
          value: entry.value
        };
      }
    });
  });
  return best;
}

function ldbPatchHardcorePlayerNbt(value) {
  const wrapped = new Uint8Array(8 + value.length);
  const header = new DataView(wrapped.buffer);
  header.setInt32(0, 10, true);
  header.setInt32(4, value.length, true);
  wrapped.set(value, 8);

  const doc = parseLevelDat(wrapped);
  const root = doc.root.value;
  const abilitiesEntry = root.get("abilities");
  if (!abilitiesEntry || abilitiesEntry.type !== T_COMP) throw new Error("leveldb-player");

  let changed = false;
  function setByte(map, key, valueToSet) {
    const existing = map.get(key);
    if (!existing || existing.type !== T_BYTE || existing.value !== valueToSet) changed = true;
    map.set(key, { type: T_BYTE, value: valueToSet });
  }

  setByte(root, "Invulnerable", 0);
  ["flying", "instabuild", "invulnerable", "mayfly"].forEach(key => {
    setByte(abilitiesEntry.value, key, 0);
  });

  const rebuilt = buildLevelDat(doc).subarray(8);
  return { bytes: rebuilt, changed: changed };
}

async function inspectLocalPlayerLevelTable(tableBytes) {
  const layout = await ldbOpenTable(tableBytes);
  const player = ldbFindLocalPlayer(layout);
  return player ? { sequence: player.sequence } : null;
}

async function readHardcoreLocalPlayerAbilities(tableBytes) {
  const layout = await ldbOpenTable(tableBytes);
  const player = ldbFindLocalPlayer(layout);
  if (!player) return null;

  const wrapped = new Uint8Array(8 + player.value.length);
  const header = new DataView(wrapped.buffer);
  header.setInt32(0, 10, true);
  header.setInt32(4, player.value.length, true);
  wrapped.set(player.value, 8);
  const root = parseLevelDat(wrapped).root.value;
  const abilities = root.get("abilities");
  if (!abilities || abilities.type !== T_COMP) throw new Error("leveldb-player");

  const output = {};
  ["flying", "instabuild", "invulnerable", "mayfly"].forEach(key => {
    const entry = abilities.value.get(key);
    output[key] = entry && entry.type === T_BYTE ? entry.value : null;
  });
  return output;
}

async function rewriteHardcoreLocalPlayerLevelTable(tableBytes) {
  const layout = await ldbOpenTable(tableBytes);
  const player = ldbFindLocalPlayer(layout);
  if (!player) throw new Error("leveldb-player");

  const patchedPlayer = ldbPatchHardcorePlayerNbt(player.value);
  if (!patchedPlayer.changed) {
    return { bytes: layout.table, changed: false, sequence: player.sequence };
  }

  player.dataBlock.entries[player.entryIndex].value = patchedPlayer.bytes;
  const targetRaw = ldbEncodeBlock(player.dataBlock.entries);
  const targetPacked = await ldbPackBlock(targetRaw, player.dataBlock.block.type);
  const oldTargetEnd = player.dataBlock.handle.offset + player.dataBlock.handle.size + 5;
  const targetDelta = targetPacked.bytes.length - (player.dataBlock.handle.size + 5);

  const dataBlocks = layout.dataBlocks.slice().sort((left, right) => left.handle.offset - right.handle.offset);
  const replacementHandles = new Map();
  const prefixParts = [];
  let prefixLength = 0;
  let cursor = 0;

  function appendPrefix(bytes) {
    prefixParts.push(bytes);
    prefixLength += bytes.length;
  }

  dataBlocks.forEach(dataBlock => {
    if (dataBlock.handle.offset < cursor || dataBlock.handle.offset + dataBlock.handle.size + 5 > layout.footer.meta.offset) {
      throw new Error("leveldb-layout");
    }
    appendPrefix(layout.table.slice(cursor, dataBlock.handle.offset));
    const replacement = dataBlock === player.dataBlock
      ? targetPacked.bytes
      : layout.table.slice(dataBlock.handle.offset, dataBlock.handle.offset + dataBlock.handle.size + 5);
    replacementHandles.set(dataBlock.handle.offset, {
      offset: prefixLength,
      size: replacement.length - 5
    });
    appendPrefix(replacement);
    cursor = dataBlock.handle.offset + dataBlock.handle.size + 5;
  });
  appendPrefix(layout.table.slice(cursor, layout.footer.meta.offset));

  function translateNonDataOffset(oldOffset) {
    return oldOffset >= oldTargetEnd ? oldOffset + targetDelta : oldOffset;
  }

  const metaEntries = layout.metaEntries.map(entry => {
    const copy = Object.assign({}, entry, { key: entry.key.slice(), value: entry.value.slice() });
    const handle = ldbReadHandle(copy.value, 0);
    if (handle.next !== copy.value.length) throw new Error("leveldb-layout");
    copy.value = ldbWriteHandle({ offset: translateNonDataOffset(handle.offset), size: handle.size });
    return copy;
  });
  const newMetaRaw = ldbEncodeBlock(metaEntries);
  const newMetaPacked = await ldbPackBlock(newMetaRaw, layout.metaBlock.type);
  const newMetaHandle = { offset: prefixLength, size: newMetaPacked.packed.length };

  const betweenMetaAndIndex = layout.table.slice(
    layout.footer.meta.offset + layout.footer.meta.size + 5,
    layout.footer.index.offset
  );
  const beforeIndex = ldbConcat([ldbConcat(prefixParts), newMetaPacked.bytes, betweenMetaAndIndex]);

  const indexEntries = layout.indexEntries.map(entry => {
    const copy = Object.assign({}, entry, { key: entry.key.slice(), value: entry.value.slice() });
    const oldHandle = ldbReadHandle(copy.value, 0);
    const replacement = replacementHandles.get(oldHandle.offset);
    if (!replacement || oldHandle.next !== copy.value.length) throw new Error("leveldb-layout");
    copy.value = ldbWriteHandle(replacement);
    return copy;
  });
  const newIndexRaw = ldbEncodeBlock(indexEntries);
  const newIndexPacked = await ldbPackBlock(newIndexRaw, layout.indexBlock.type);
  const newIndexHandle = { offset: beforeIndex.length, size: newIndexPacked.packed.length };

  const footerPrefix = ldbConcat([ldbWriteHandle(newMetaHandle), ldbWriteHandle(newIndexHandle)]);
  if (footerPrefix.length > 40) throw new Error("leveldb-layout");
  const newFooter = new Uint8Array(LDB_FOOTER_SIZE);
  newFooter.set(footerPrefix, 0);
  newFooter.set(LDB_MAGIC, 40);

  const output = ldbConcat([beforeIndex, newIndexPacked.bytes, newFooter]);
  const verified = await readHardcoreLocalPlayerAbilities(output);
  if (!verified || Object.keys(verified).some(key => verified[key] !== 0)) throw new Error("leveldb-verify");
  return { bytes: output, changed: true, sequence: player.sequence };
}

function ldbPatchManifestFileSize(manifestBytes, fileNumber, newFileSize) {
  const manifest = new Uint8Array(manifestBytes).slice();
  let position = 0;
  let patched = false;

  function skipLengthPrefixed(payload, offset) {
    const length = ldbReadVarint(payload, offset);
    if (length.next + length.value > payload.length) throw new Error("leveldb-manifest");
    return length.next + length.value;
  }

  while (position + 7 <= manifest.length) {
    const recordLength = manifest[position + 4] | (manifest[position + 5] << 8);
    const recordType = manifest[position + 6];
    if (recordLength === 0 && recordType === 0) break;
    if (recordType !== 1 || position + 7 + recordLength > manifest.length) throw new Error("leveldb-manifest");

    const payloadStart = position + 7;
    const payload = manifest.subarray(payloadStart, payloadStart + recordLength);
    let cursor = 0;
    while (cursor < payload.length) {
      const tagInfo = ldbReadVarint(payload, cursor);
      const tag = tagInfo.value;
      cursor = tagInfo.next;
      if (tag === 1) cursor = skipLengthPrefixed(payload, cursor);
      else if (tag === 2 || tag === 3 || tag === 4 || tag === 9) cursor = ldbReadVarint(payload, cursor).next;
      else if (tag === 5) {
        cursor = ldbReadVarint(payload, cursor).next;
        cursor = skipLengthPrefixed(payload, cursor);
      } else if (tag === 6) {
        cursor = ldbReadVarint(payload, cursor).next;
        cursor = ldbReadVarint(payload, cursor).next;
      } else if (tag === 7) {
        cursor = ldbReadVarint(payload, cursor).next;
        const numberInfo = ldbReadVarint(payload, cursor);
        cursor = numberInfo.next;
        const sizeStart = cursor;
        const sizeInfo = ldbReadVarint(payload, cursor);
        cursor = sizeInfo.next;
        if (numberInfo.value === fileNumber) {
          const encodedSize = ldbWriteVarint(newFileSize);
          if (encodedSize.length !== sizeInfo.next - sizeStart) throw new Error("leveldb-manifest-size");
          payload.set(encodedSize, sizeStart);
          patched = true;
        }
        cursor = skipLengthPrefixed(payload, cursor);
        cursor = skipLengthPrefixed(payload, cursor);
      } else {
        throw new Error("leveldb-manifest");
      }
    }

    const crcInput = ldbConcat([Uint8Array.of(recordType), payload]);
    const crc = ldbMaskCrc(ldbCrc32c(crcInput));
    new DataView(manifest.buffer, manifest.byteOffset, manifest.byteLength).setUint32(position, crc, true);
    position += 7 + recordLength;
  }

  if (!patched) throw new Error("leveldb-manifest-file");
  return manifest;
}
