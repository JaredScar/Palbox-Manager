import net from 'net';

const SERVERDATA_AUTH = 3;
const SERVERDATA_AUTH_RESPONSE = 2;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;

interface RconPacket {
  id: number;
  type: number;
  body: string;
}

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body + '\0', 'utf8');
  const size = 4 + 4 + bodyBuf.length + 1; // id + type + body + trailing null
  const buf = Buffer.allocUnsafe(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeUInt8(0, 12 + bodyBuf.length);
  return buf;
}

function decodePackets(data: Buffer): RconPacket[] {
  const packets: RconPacket[] = [];
  let offset = 0;
  while (offset + 4 <= data.length) {
    const size = data.readInt32LE(offset);
    if (offset + 4 + size > data.length) break;
    const id = data.readInt32LE(offset + 4);
    const type = data.readInt32LE(offset + 8);
    const bodyEnd = offset + 4 + size - 2;
    const body = data.slice(offset + 12, bodyEnd).toString('utf8');
    packets.push({ id, type, body });
    offset += 4 + size;
  }
  return packets;
}

export class RconClient {
  private host: string;
  private port: number;
  private password: string;
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private reqId = 1;
  private pendingMap = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();

  constructor(host: string, port: number, password: string) {
    this.host = host;
    this.port = port;
    this.password = password;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      this.socket = sock;

      sock.connect(this.port, this.host, async () => {
        try {
          await this.sendRaw(SERVERDATA_AUTH, this.password, true);
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      sock.on('data', (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const packets = decodePackets(this.buffer);
        for (const pkt of packets) {
          const handler = this.pendingMap.get(pkt.id);
          if (handler) {
            this.pendingMap.delete(pkt.id);
            if (pkt.type === SERVERDATA_AUTH_RESPONSE && pkt.id === -1) {
              handler.reject(new Error('RCON authentication failed'));
            } else {
              handler.resolve(pkt.body);
            }
          }
        }
        // Consume processed data
        let consumed = 0;
        let offset = 0;
        while (offset + 4 <= this.buffer.length) {
          const size = this.buffer.readInt32LE(offset);
          if (offset + 4 + size > this.buffer.length) break;
          consumed = offset + 4 + size;
          offset += 4 + size;
        }
        if (consumed > 0) this.buffer = this.buffer.slice(consumed);
      });

      sock.on('error', (err) => {
        this.socket = null;
        reject(err);
      });

      sock.on('close', () => {
        this.socket = null;
        for (const [, h] of this.pendingMap) {
          h.reject(new Error('RCON socket closed'));
        }
        this.pendingMap.clear();
      });
    });
  }

  private sendRaw(type: number, body: string, isAuth = false): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'));
      const id = isAuth ? 1 : this.reqId++;
      this.pendingMap.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pendingMap.has(id)) {
          this.pendingMap.delete(id);
          reject(new Error('RCON request timed out'));
        }
      }, 5000);
      this.socket.write(encodePacket(id, type, body));
    });
  }

  send(command: string): Promise<string> {
    return this.sendRaw(SERVERDATA_EXECCOMMAND, command);
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = null;
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }
}

// Stateless helper — opens, authenticates, runs command, closes
export async function rconExec(
  host: string,
  port: number,
  password: string,
  command: string,
): Promise<string> {
  const client = new RconClient(host, port, password);
  await client.connect();
  const result = await client.send(command);
  client.disconnect();
  return result;
}
