/**
 * Adapter around the `rconify` package.
 *
 * rconify is deliberately permissive about servers that stray from the Source
 * spec — its `ignoreInvalidAuthResponse` accepts any reply as a successful
 * auth, and it reads whatever a single `data` event delivers without checking
 * the declared frame length. That leniency is the reason to try it against
 * Palworld.
 *
 * It has no timeout on any operation, though, so an unresponsive server leaves
 * its promises permanently unsettled. Everything below is bounded here, and a
 * spare error listener is attached so a late socket error cannot reach
 * uncaughtException and take the panel down with it.
 */
import { RconClient as RconifyClient } from 'rconify';

export async function rconifyExec(
  host: string,
  port: number,
  password: string,
  command: string,
  timeoutMs = 5000,
): Promise<string> {
  const client = new RconifyClient({
    host,
    port,
    password,
    // Palworld does not answer auth the way the spec describes.
    ignoreInvalidAuthResponse: true,
  });

  let timer: NodeJS.Timeout | undefined;
  const expire = (phase: string) =>
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`RCONIFY_TIMEOUT: no response during ${phase} from ${host}:${port} within ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

  try {
    // createConnection runs synchronously inside connect(), so the socket is
    // available immediately and can be guarded before anything can fail on it.
    const connecting = client.connect();
    client.socket?.on('error', () => { /* absorbed; the race below reports it */ });

    await Promise.race([connecting, expire('authentication')]);
    clearTimeout(timer);

    return await Promise.race([client.sendCommand(command), expire('command')]);
  } finally {
    clearTimeout(timer);
    try { client.disconnect(); } catch { /* not connected */ }
    try { client.socket?.destroy(); } catch { /* already gone */ }
  }
}
