/**
 * Source-protocol RCON client, tuned for Palworld.
 *
 * Palworld's RCON is a loose reimplementation of the Source protocol and
 * breaks two assumptions a strict client makes: it does not reliably echo the
 * request id on the auth response, and it can declare a packet size larger
 * than the payload it actually sends. A strict length-prefixed reader waits
 * forever for the missing bytes, which surfaces as a bogus timeout even though
 * the reply already arrived. The assembler below falls back to a lenient read
 * when a frame stops making progress.
 *
 * RCON is legacy — see services/connection.ts, which prefers the REST API and
 * only reaches for this when there is no REST equivalent.
 */
import net from 'net';
import { rconifyExec } from './rconify-client.js';

const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;

/** How long a frame may sit incomplete before it is read leniently. */
const FRAME_GRACE_MS = 250;

interface RconPacket {
  id: number;
  type: number;
  body: string;
}

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyLen = Buffer.byteLength(body, 'utf8');
  // size counts everything after itself: id + type + body + two terminators.
  const size = 4 + 4 + bodyLen + 2;
  const buf = Buffer.alloc(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  buf.write(body, 12, 'utf8');
  return buf;
}

/**
 * Packet ids in the range other Palworld clients use. Low ids (0, 1, 2) are
 * reserved or special-cased by some server builds, so staying well clear of
 * them removes a variable.
 */
function randomPacketId(): number {
  return Math.trunc(Math.random() * (0x98967f - 0xf4240) + 0xf4240);
}

/** Reassembles the TCP byte stream into packets, tolerating bad size fields. */
class PacketAssembler {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  get pendingBytes(): number {
    return this.buffer.length;
  }

  /** First bytes still unread, for diagnostics when a frame never completes. */
  preview(): string {
    return this.buffer.subarray(0, 32).toString('hex');
  }

  /** Reads only frames whose declared size has fully arrived. */
  read(): RconPacket[] {
    const packets: RconPacket[] = [];
    let offset = 0;
    while (offset + 12 <= this.buffer.length) {
      const size = this.buffer.readInt32LE(offset);
      if (size < 10 || offset + 4 + size > this.buffer.length) break;
      packets.push(this.decodeAt(offset, size));
      offset += 4 + size;
    }
    if (offset > 0) this.buffer = this.buffer.subarray(offset);
    return packets;
  }

  /**
   * Reads whatever is buffered even when the declared size overshoots it.
   * Used once a frame has stalled past the grace period — at that point the
   * missing bytes are not late, they were never going to be sent.
   */
  readLenient(): RconPacket[] {
    if (this.buffer.length < 12) return [];
    const size = this.buffer.readInt32LE(0);
    const packet = this.decodeAt(0, size);
    this.buffer = Buffer.alloc(0);
    return [packet];
  }

  private decodeAt(offset: number, size: number): RconPacket {
    const id = this.buffer.readInt32LE(offset + 4);
    const type = this.buffer.readInt32LE(offset + 8);
    // Trim the two terminators, clamped so an oversized size field cannot
    // read past what actually arrived.
    const end = Math.min(offset + 4 + size - 2, this.buffer.length);
    const body = this.buffer.subarray(offset + 12, Math.max(offset + 12, end)).toString('utf8');
    // An oversized size field leaves the terminators inside the clamped range.
    return { id, type, body: body.replace(/\0+$/, '').replace(/\n$/, '') };
  }
}

export class RconClient {
  private host: string;
  private port: number;
  private password: string;
  private socket: net.Socket | null = null;
  private assembler = new PacketAssembler();
  private graceTimer: NodeJS.Timeout | null = null;
  private authId: number | null = null;
  private pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();
  /** Raw hex of a stalled frame, surfaced in the timeout message. */
  private lastStall: string | null = null;

  constructor(host: string, port: number, password: string) {
    this.host = host;
    this.port = port;
    this.password = password;
  }

  /**
   * Opens the socket and authenticates.
   *
   * A bare net.Socket has no connect timeout, so a firewall that drops SYN
   * packets instead of sending RST would hang this forever. The TCP handshake
   * and the auth exchange are timed separately: "could not reach the host" and
   * "reached it but nothing spoke RCON back" have entirely different causes.
   */
  connect(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      this.socket = sock;
      // Auth and command packets are tiny; Nagle would only add latency.
      sock.setNoDelay(true);

      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        this.teardown();
        reject(err);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        resolve();
      };

      const connectTimer = setTimeout(
        () => fail(new Error(`RCON_UNREACHABLE: no TCP connection to ${this.host}:${this.port} within ${timeoutMs}ms`)),
        timeoutMs,
      );

      sock.on('data', (chunk) => this.onData(chunk));
      sock.on('error', (err) => fail(err));
      sock.on('close', () => {
        this.socket = null;
        this.rejectAll(new Error('RCON socket closed by the server'));
      });

      sock.connect(this.port, this.host, async () => {
        clearTimeout(connectTimer);
        try {
          await this.sendRaw(SERVERDATA_AUTH, this.password, true, timeoutMs);
          succeed();
        } catch (e) {
          const msg = (e as Error).message;
          if (msg.includes('RCON_')) { fail(e as Error); return; }
          const detail = this.lastStall
            ? ` The server sent ${this.lastStall} but declared a longer packet.`
            : ' Nothing was received.';
          fail(new Error(
            `RCON_NO_REPLY: connected to ${this.host}:${this.port} but the auth request went unanswered.${detail}`,
          ));
        }
      });
    });
  }

  private onData(chunk: Buffer): void {
    this.assembler.push(chunk);
    this.dispatch(this.assembler.read());

    if (this.graceTimer) clearTimeout(this.graceTimer);
    // Bytes left over are either the front of a split frame or a frame whose
    // declared size overshot. Give the network a moment to prove it is the
    // former before reading it the lenient way.
    if (this.assembler.pendingBytes >= 12) {
      this.lastStall = this.assembler.preview();
      this.graceTimer = setTimeout(() => {
        this.dispatch(this.assembler.readLenient());
      }, FRAME_GRACE_MS);
    }
  }

  private dispatch(packets: RconPacket[]): void {
    for (const pkt of packets) {
      // A rejected password comes back as id -1 rather than the request id, so
      // a plain lookup never matches and a bad password would otherwise sit
      // there until the request timed out.
      if (pkt.id === -1) {
        this.rejectAll(new Error('RCON_BAD_PASSWORD: the server rejected the RCON password'));
        continue;
      }

      // Palworld does not reliably echo the request id on either the auth
      // response or command output. Only one request is ever in flight, so
      // when exactly one is outstanding an unrecognised id is still
      // unambiguously its reply. Matching on id alone made every command
      // against such a server time out despite the response having arrived.
      const key = this.pending.has(pkt.id) ? pkt.id
        : this.pending.size === 1 ? this.pending.keys().next().value!
        : null;
      if (key === null) continue;

      const handler = this.pending.get(key)!;
      this.pending.delete(key);
      handler.resolve(pkt.body);
    }
  }

  private rejectAll(err: Error): void {
    for (const [, h] of this.pending) h.reject(err);
    this.pending.clear();
  }

  private teardown(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.socket?.destroy();
    this.socket = null;
  }

  private sendRaw(type: number, body: string, isAuth = false, timeoutMs = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'));
      const id = randomPacketId();
      if (isAuth) this.authId = id;

      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        if (isAuth) this.authId = null;
        reject(new Error('RCON request timed out'));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); if (isAuth) this.authId = null; resolve(v); },
        reject:  (e) => { clearTimeout(timer); if (isAuth) this.authId = null; reject(e); },
      });

      this.socket.write(encodePacket(id, type, body));
    });
  }

  send(command: string, timeoutMs = 5000): Promise<string> {
    return this.sendRaw(SERVERDATA_EXECCOMMAND, command, false, timeoutMs);
  }

  disconnect(): void {
    this.teardown();
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }
}

/**
 * Opens, authenticates, runs one command, closes. The finally block releases
 * the socket even when connect() or send() throws.
 */
export async function nativeRconExec(
  host: string,
  port: number,
  password: string,
  command: string,
  timeoutMs = 5000,
): Promise<string> {
  const client = new RconClient(host, port, password);
  try {
    await client.connect(timeoutMs);
    return await client.send(command, timeoutMs);
  } finally {
    client.disconnect();
  }
}

/**
 * Two RCON implementations, tried in order. They put identical bytes on the
 * wire and differ only in how forgiving they are about the reply.
 *
 * The native client goes first because it is the more accurate of the two: it
 * reassembles multi-packet responses, decodes UTF-8 so non-ASCII player names
 * survive, and reports a rejected password as a rejection. rconify decodes as
 * ASCII and, because it treats any reply as a successful auth, reports a wrong
 * password as success with empty output — which would look like a working
 * connection returning nothing.
 *
 * rconify is kept as a fallback for quirks the native client has not been
 * taught yet. scripts/rcon-strategy-test.mjs exercises both against a mock of
 * Palworld's known deviations.
 */
export const RCON_STRATEGIES = [
  { name: 'native',  exec: nativeRconExec },
  { name: 'rconify', exec: rconifyExec },
] as const;

export type RconStrategyName = (typeof RCON_STRATEGIES)[number]['name'];

/** Strategy that last succeeded, keyed by "host:port". */
const preferredStrategy = new Map<string, RconStrategyName>();

export function forgetRconStrategy(host: string, port: number): void {
  preferredStrategy.delete(`${host}:${port}`);
}

export interface RconAttempt {
  strategy: RconStrategyName;
  error: string;
}

export class RconAllStrategiesFailed extends Error {
  constructor(public attempts: RconAttempt[]) {
    super(attempts.map((a) => `${a.strategy}: ${a.error}`).join(' | '));
    this.name = 'RconAllStrategiesFailed';
  }
}

/**
 * Runs a command, trying each implementation until one answers and caching
 * the winner so later calls go straight to it.
 */
export async function rconExecDetailed(
  host: string,
  port: number,
  password: string,
  command: string,
  timeoutMs = 5000,
): Promise<{ result: string; strategy: RconStrategyName }> {
  const key = `${host}:${port}`;
  const known = preferredStrategy.get(key);
  const ordered = known
    ? [...RCON_STRATEGIES].sort((a, b) => (a.name === known ? -1 : b.name === known ? 1 : 0))
    : [...RCON_STRATEGIES];

  const attempts: RconAttempt[] = [];
  for (const strategy of ordered) {
    try {
      const result = await strategy.exec(host, port, password, command, timeoutMs);
      preferredStrategy.set(key, strategy.name);
      return { result, strategy: strategy.name };
    } catch (e) {
      const message = (e as Error).message;
      attempts.push({ strategy: strategy.name, error: message });
      // A rejected password is a definitive answer, not a quirk to route
      // around. Falling through would hand it to an implementation that
      // reports rejection as success and mask a simple misconfiguration.
      if (message.includes('RCON_BAD_PASSWORD')) break;
    }
  }

  preferredStrategy.delete(key);
  throw new RconAllStrategiesFailed(attempts);
}

export async function rconExec(
  host: string,
  port: number,
  password: string,
  command: string,
  timeoutMs = 5000,
): Promise<string> {
  return (await rconExecDetailed(host, port, password, command, timeoutMs)).result;
}
