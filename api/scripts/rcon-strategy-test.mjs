/**
 * Runs every RCON implementation against a mock server that reproduces the
 * ways Palworld is known to stray from the Source spec.
 *
 * Palworld cannot be installed in CI and a live server cannot be reached from
 * a dev machine, so the quirks are simulated instead. This is what tells us
 * whether a given implementation would cope, without guessing.
 *
 *   npm run -w api build && node api/scripts/rcon-strategy-test.mjs
 */
import net from 'net';
import { RCON_STRATEGIES } from '../dist/lib/rcon.js';

const PASSWORD = 'testpass';

function packet(id, type, body, sizeOverride) {
  const bodyLen = Buffer.byteLength(body, 'utf8');
  const buf = Buffer.alloc(bodyLen + 14);
  buf.writeInt32LE(sizeOverride ?? bodyLen + 10, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  buf.write(body, 12, 'utf8');
  return buf;
}

/** Each mode reproduces one documented deviation from the Source spec. */
const MODES = {
  spec: (sock, req) => {
    if (req.type === 3) {
      sock.write(packet(req.id, 0, ''));
      sock.write(packet(req.id, 2, ''));
    } else {
      sock.write(packet(req.id, 0, 'name,playeruid,steamid\nAlice,1,7656119'));
    }
  },

  // Declares a longer packet than it actually sends.
  oversized: (sock, req) => {
    const type = req.type === 3 ? 2 : 0;
    const body = req.type === 3 ? '' : 'name,playeruid,steamid\nAlice,1,7656119';
    const bodyLen = Buffer.byteLength(body, 'utf8');
    sock.write(packet(req.id, type, body, bodyLen + 40));
  },

  // Replies, but with an id that is not the one we sent.
  noEcho: (sock, req) => {
    const type = req.type === 3 ? 2 : 0;
    const body = req.type === 3 ? '' : 'name,playeruid,steamid\nAlice,1,7656119';
    sock.write(packet(0, type, body));
  },

  // Accepts the connection and then says nothing at all.
  silent: () => {},

  // Rejects the password the way the spec describes.
  badPassword: (sock) => sock.write(packet(-1, 2, '')),
};

function startMock(mode) {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.on('data', (chunk) => {
        let offset = 0;
        while (offset + 12 <= chunk.length) {
          const size = chunk.readInt32LE(offset);
          const id = chunk.readInt32LE(offset + 4);
          const type = chunk.readInt32LE(offset + 8);
          MODES[mode](sock, { id, type });
          offset += 4 + size;
        }
      });
      sock.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
for (const mode of Object.keys(MODES)) {
  const server = await startMock(mode);
  const { port } = server.address();

  for (const strategy of RCON_STRATEGIES) {
    const t0 = Date.now();
    let outcome;
    try {
      const out = await strategy.exec('127.0.0.1', port, PASSWORD, 'ShowPlayers', 2000);
      outcome = `OK  ${JSON.stringify(out.slice(0, 40))}`;
    } catch (e) {
      outcome = `FAIL  ${e.message.split(':')[0]}`;
    }
    results.push({ mode, strategy: strategy.name, ms: Date.now() - t0, outcome });
  }
  server.close();
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad('server behaviour', 14)}${pad('implementation', 16)}${pad('ms', 7)}result`);
console.log('-'.repeat(78));
for (const r of results) {
  console.log(`${pad(r.mode, 14)}${pad(r.strategy, 16)}${pad(r.ms, 7)}${r.outcome}`);
}
console.log();
