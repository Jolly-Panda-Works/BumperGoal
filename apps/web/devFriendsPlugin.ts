import type { Plugin } from 'vite';
import type { createLocalFriendServer } from './src/dev/localFriendServer.ts';

/** Dev-only HTTP authority. No endpoints or local invitation code are emitted into production. */
export function devFriendsPlugin(): Plugin {
  return {
    name: 'local-friends',
    apply: 'serve',
    configureServer(server) {
      let backend: Promise<Awaited<ReturnType<typeof createLocalFriendServer>>> | undefined;
      let timer: ReturnType<typeof setInterval> | undefined;
      const load = () =>
        (backend ??= server
          .ssrLoadModule('/src/dev/localFriendServer.ts')
          .then(async (module) => {
            const value = await (module.createLocalFriendServer as typeof createLocalFriendServer)();
            timer = setInterval(() => value.tick(), 1000);
            timer.unref();
            return value;
          })
          .catch((error) => {
            backend = undefined;
            throw error;
          }));
      server.httpServer?.once('close', () => clearInterval(timer));
      server.middlewares.use('/__local-friends', async (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        let sameOrigin: boolean;
        try {
          sameOrigin = !request.headers.origin || new URL(request.headers.origin).host === request.headers.host;
        } catch {
          sameOrigin = false;
        }
        if (request.method !== 'POST' || !sameOrigin) {
          response.statusCode = 403;
          response.end('{"error":"unauthorized"}');
          return;
        }
        try {
          let payload = '';
          for await (const chunk of request) {
            payload += chunk.toString();
            if (payload.length > 8192) throw new Error('invalid');
          }
          const data = JSON.parse(payload) as Record<string, unknown>;
          const service = await load();
          response.end(
            JSON.stringify(service.handle(String(data.action), String(request.headers['x-local-session'] ?? ''), data)),
          );
        } catch (error) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'unavailable' }));
        }
      });
    },
  };
}
