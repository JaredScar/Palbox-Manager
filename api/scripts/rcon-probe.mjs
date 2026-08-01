/**
 * Standalone RCON wire probe.
 *
 * Connects, sends an auth packet, and dumps every raw byte the server returns
 * without interpreting the length field. Use this when the panel reports RCON
 * as unreachable but other tools connect fine — it shows whether the server is
 * silent or is replying with a frame we cannot parse.
 *
 *   node api/scripts/rcon-probe.mjs <host> <port> <password> [command]
 */
import net from 'net';

const [host, portArg, password, command = 'Info'] = process.argv.slice(2);
if (!host || !portArg || !password) {
  console.error('usage: node rcon-probe.mjs <host> <port> <password> [command]');
  process.exit(1);
}
const port = Number(portArg);

function encode(id, type, body) {
  const len = Buffer.byteLength(body, 'utf8');
  const buf = Buffer.alloc(len + 14);
  buf.writeInt32LE(len + 10, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  buf.write(body, 12, 'utf8');
  return buf;
}

function describe(buf) {
  if (buf.length < 12) return `  (${buf.length} bytes, too short for a header)`;
  const size = buf.readInt32LE(0);
  const id = buf.readInt32LE(4);
  const type = buf.readInt32LE(8);
  const declared = size + 4;
  return [
    `  declared size field : ${size}  (implies ${declared} total bytes)`,
    `  actually received   : ${buf.length} bytes`,
    `  id                  : ${id}`,
    `  type                : ${type}`,
    `  body                : ${JSON.stringify(buf.subarray(12, Math.max(12, Math.min(declared - 2, buf.length))).toString('utf8'))}`,
    declared !== buf.length
      ? `  >> MISMATCH: the size field disagrees with the byte count, which is what stalls a strict parser.`
      : `  >> frame is well formed`,
  ].join('\n');
}

const AUTH_ID = Math.trunc(Math.random() * 9e6 + 1e6);
const sock = new net.Socket();
sock.setNoDelay(true);

const connectTimer = setTimeout(() => {
  console.error(`No TCP connection to ${host}:${port} within 8s — packets are being dropped.`);
  sock.destroy();
  process.exit(2);
}, 8000);

sock.on('error', (e) => {
  clearTimeout(connectTimer);
  console.error(`Socket error: ${e.message}`);
  process.exit(2);
});

sock.connect(port, host, () => {
  clearTimeout(connectTimer);
  console.log(`TCP connected to ${host}:${port}`);
  console.log(`Sending AUTH  id=${AUTH_ID}\n`);
  sock.write(encode(AUTH_ID, 3, password));

  setTimeout(() => {
    console.log(`\nSending COMMAND ${JSON.stringify(command)}\n`);
    sock.write(encode(AUTH_ID + 1, 2, command));
  }, 1500);

  setTimeout(() => {
    console.log('\nDone.');
    sock.destroy();
    process.exit(0);
  }, 4000);
});

let n = 0;
sock.on('data', (chunk) => {
  console.log(`--- chunk ${++n} -------------------------------------------`);
  console.log(`  hex: ${chunk.subarray(0, 64).toString('hex')}`);
  console.log(describe(chunk));
});

sock.on('close', () => console.log('Socket closed by peer.'));
