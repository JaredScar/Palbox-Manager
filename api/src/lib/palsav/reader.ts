/**
 * Reader for Unreal's GVAS serialisation as Palworld writes it.
 *
 * This is a faithful port of the parts of the community palworld-save-tools
 * FArchiveReader that we need. Only the read path exists here: Palbox never
 * writes save files, and leaving out the writer removes any chance of this
 * code corrupting someone's world.
 */

/** A 16-byte Unreal GUID, kept as bytes until something asks for a string. */
export type Guid = string;

/** Unreal stores GUIDs as four little-endian 32-bit groups. */
function guidToString(b: Buffer): Guid {
  const hex = (i: number) => b[i].toString(16).padStart(2, '0');
  const group = (start: number) => hex(start + 3) + hex(start + 2) + hex(start + 1) + hex(start);
  const raw = group(0) + group(4) + group(8) + group(12);
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

export const NULL_GUID = '00000000-0000-0000-0000-000000000000';

export interface Vector { x: number; y: number; z: number }
export interface Transform { translation: Vector }

export class SavReader {
  private off: number;

  constructor(private readonly buf: Buffer, offset = 0) {
    this.off = offset;
  }

  get offset(): number { return this.off; }
  get eof(): boolean { return this.off >= this.buf.length; }
  get remaining(): number { return this.buf.length - this.off; }

  private need(n: number): void {
    if (this.off + n > this.buf.length) {
      throw new Error(`Save data ended early: wanted ${n} bytes at ${this.off}, ${this.remaining} left`);
    }
  }

  skip(n: number): void { this.need(n); this.off += n; }

  u8(): number { this.need(1); return this.buf[this.off++]; }
  bool(): boolean { return this.u8() > 0; }
  u16(): number { this.need(2); const v = this.buf.readUInt16LE(this.off); this.off += 2; return v; }
  i32(): number { this.need(4); const v = this.buf.readInt32LE(this.off); this.off += 4; return v; }
  u32(): number { this.need(4); const v = this.buf.readUInt32LE(this.off); this.off += 4; return v; }
  f32(): number { this.need(4); const v = this.buf.readFloatLE(this.off); this.off += 4; return v; }
  f64(): number { this.need(8); const v = this.buf.readDoubleLE(this.off); this.off += 8; return v; }

  /** i64/u64 as a JS number. Used for sizes and timestamps, both well inside 2^53. */
  i64(): number { this.need(8); const v = this.buf.readBigInt64LE(this.off); this.off += 8; return Number(v); }
  u64(): number { this.need(8); const v = this.buf.readBigUInt64LE(this.off); this.off += 8; return Number(v); }

  bytes(n: number): Buffer { this.need(n); const b = this.buf.subarray(this.off, this.off + n); this.off += n; return b; }

  /**
   * Unreal FString: a length, then the characters and a terminator. A negative
   * length means UTF-16, and the count is in characters rather than bytes.
   */
  fstring(): string {
    const size = this.i32();
    if (size === 0) return '';
    if (size < 0) {
      const chars = -size;
      const raw = this.bytes(chars * 2);
      return raw.subarray(0, raw.length - 2).toString('utf16le');
    }
    const raw = this.bytes(size);
    return raw.subarray(0, raw.length - 1).toString('latin1');
  }

  guid(): Guid { return guidToString(this.bytes(16)); }

  /** A flag byte, then a GUID only if the flag is set. */
  optionalGuid(): Guid | null { return this.bool() ? this.guid() : null; }

  tarray<T>(item: (r: SavReader) => T): T[] {
    const count = this.u32();
    const out: T[] = [];
    for (let i = 0; i < count; i++) out.push(item(this));
    return out;
  }

  vector(): Vector { return { x: this.f64(), y: this.f64(), z: this.f64() }; }

  /** Quat (4 doubles), translation (3), then scale (3). */
  ftransform(): Transform {
    this.skip(32);
    const translation = this.vector();
    this.skip(24);
    return { translation };
  }

  /** Reads a property block, stopping at the "None" sentinel that closes it. */
  propertiesUntilNone(): Record<string, PropValue> {
    const out: Record<string, PropValue> = {};
    for (;;) {
      const name = this.fstring();
      if (name === 'None') break;
      const type = this.fstring();
      const size = this.u64();
      out[name] = this.property(type, size);
    }
    return out;
  }

  /**
   * Reads one property value. Every branch must consume exactly the bytes the
   * property occupies, because the reader stays positioned for whatever comes
   * next - a type handled loosely here desynchronises everything after it.
   */
  property(type: string, size: number, opts?: PropertyOptions): PropValue {
    switch (type) {
      case 'StructProperty': {
        const structType = this.fstring();
        this.skip(16);          // struct id
        this.optionalGuid();
        return { type, value: this.structValue(structType, size) };
      }
      case 'ArrayProperty': {
        const arrayType = this.fstring();
        this.optionalGuid();
        const count = this.u32();
        if (arrayType === 'ByteProperty') {
          // The fast path palworld-save-tools uses: raw bytes, no per-item tag.
          return { type, value: this.bytes(count) };
        }
        if (arrayType === 'StructProperty') {
          this.fstring();       // prop name
          this.fstring();       // prop type
          this.u64();           // payload size
          const itemType = this.fstring();
          this.skip(16 + 1);    // id + padding
          const values: unknown[] = [];
          for (let i = 0; i < count; i++) values.push(this.structValue(itemType, 0));
          return { type, value: values };
        }
        const values: unknown[] = [];
        for (let i = 0; i < count; i++) {
          if (arrayType === 'NameProperty' || arrayType === 'EnumProperty') values.push(this.fstring());
          else if (arrayType === 'Guid') values.push(this.guid());
          else if (arrayType === 'IntProperty') values.push(this.i32());
          else if (arrayType === 'FloatProperty') values.push(this.f32());
          else throw new Error(`Unsupported array element type: ${arrayType}`);
        }
        return { type, value: values };
      }
      case 'MapProperty': {
        const keyType = this.fstring();
        const valueType = this.fstring();
        this.optionalGuid();
        this.u32();             // keys-to-remove, always zero in practice
        const count = this.u32();
        const entries: MapEntry[] = [];
        for (let i = 0; i < count; i++) {
          // Which struct a map key holds is not recorded in the file; it is a
          // property of the map itself, so the caller has to say.
          const key = this.mapHalf(keyType, opts?.keyStruct ?? 'Guid');
          const value = this.mapHalf(valueType, 'StructProperty');
          entries.push({ key, value });
        }
        return { type, value: entries };
      }
      case 'SetProperty': {
        // Palworld 1.0 writes the Pal-box locker index as a Set. Nothing here
        // needs it, but it has to be consumed exactly or every property after
        // it is misread. The header matches ArrayProperty's; `size` covers the
        // payload that follows.
        this.fstring();         // element type
        this.optionalGuid();
        this.skip(size);
        return { type, value: null };
      }
      case 'EnumProperty': {
        this.fstring();         // enum type
        this.optionalGuid();
        return { type, value: this.fstring() };
      }
      case 'ByteProperty': {
        const enumType = this.fstring();
        this.optionalGuid();
        return { type, value: enumType === 'None' ? this.u8() : this.fstring() };
      }
      case 'BoolProperty': {
        const v = this.bool();
        this.optionalGuid();
        return { type, value: v };
      }
      case 'NameProperty':
      case 'StrProperty':
        this.optionalGuid();
        return { type, value: this.fstring() };
      case 'IntProperty':
      case 'FixedPoint64Property':
        this.optionalGuid();
        return { type, value: this.i32() };
      case 'UInt32Property':
        this.optionalGuid();
        return { type, value: this.u32() };
      case 'UInt16Property':
        this.optionalGuid();
        return { type, value: this.u16() };
      case 'Int64Property':
        this.optionalGuid();
        return { type, value: this.i64() };
      case 'UInt64Property':
        // PlayStation players carry PsnAccountId as one of these.
        this.optionalGuid();
        return { type, value: this.u64() };
      case 'FloatProperty':
        this.optionalGuid();
        return { type, value: this.f32() };
      case 'DoubleProperty':
        this.optionalGuid();
        return { type, value: this.f64() };
      default:
        throw new Error(`Unsupported property type: ${type}`);
    }
  }

  /** Map keys and values are written bare, without the usual property header. */
  private mapHalf(type: string, structDefault: string): unknown {
    switch (type) {
      case 'StructProperty': return this.structValue(structDefault, 0);
      case 'EnumProperty':
      case 'NameProperty':   return this.fstring();
      case 'IntProperty':    return this.i32();
      case 'BoolProperty':   return this.bool();
      default: throw new Error(`Unsupported map half type: ${type}`);
    }
  }

  private structValue(structType: string, size: number): unknown {
    switch (structType) {
      case 'Guid':        return this.guid();
      case 'Vector':      return this.vector();
      case 'Quat':        this.skip(32); return null;
      case 'DateTime':    return this.u64();
      case 'LinearColor': this.skip(16); return null;
      default:
        // Anything else is a plain nested property block. `size` is only a
        // hint here; the None sentinel is what actually ends it.
        void size;
        return this.propertiesUntilNone();
    }
  }
}

export interface PropValue { type: string; value: unknown }
export interface MapEntry { key: unknown; value: unknown }

export interface PropertyOptions {
  /**
   * Struct type of a MapProperty's keys. "Guid" reads a bare GUID; any other
   * name falls through to a nested property block, which is what maps keyed on
   * a composite struct (such as the character map) use.
   */
  keyStruct?: string;
}

/**
 * Byte pattern of a property name as it appears in the file: an FString of the
 * name, immediately followed by an FString of its type. Searching for this is
 * how we jump straight to a property without walking (and fully parsing) the
 * hundreds of megabytes of character data that precede it.
 */
export function findProperty(buf: Buffer, name: string, type: string): number | null {
  const needle = Buffer.alloc(4 + name.length + 1);
  needle.writeInt32LE(name.length + 1, 0);
  needle.write(name, 4, 'latin1');
  needle[4 + name.length] = 0;

  const typeTag = Buffer.alloc(4 + type.length + 1);
  typeTag.writeInt32LE(type.length + 1, 0);
  typeTag.write(type, 4, 'latin1');
  typeTag[4 + type.length] = 0;

  let from = 0;
  for (;;) {
    const at = buf.indexOf(needle, from);
    if (at === -1) return null;
    // Confirm the type tag follows, so a stray occurrence of the name inside
    // some other blob cannot be mistaken for the property itself.
    if (buf.subarray(at + needle.length, at + needle.length + typeTag.length).equals(typeTag)) {
      return at + needle.length + typeTag.length;
    }
    from = at + 1;
  }
}
