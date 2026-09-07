import 'dotenv/config';

import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import { loadTokenServerEnvironment } from './config.js';
import { logger } from './logger.js';

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Content-Type',
  });
  response.end(JSON.stringify(body));
}

async function handleTokenRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    });
    response.end();
    return;
  }

  const requestUrl = new URL(request.url ?? '/', 'http://localhost');
  if (request.method !== 'GET' || requestUrl.pathname !== '/token') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  const room = requestUrl.searchParams.get('room');
  const identity = requestUrl.searchParams.get('identity');
  if (!room || !identity) {
    sendJson(response, 400, { error: 'room and identity are required query parameters' });
    return;
  }

  const environment = loadTokenServerEnvironment();
  const token = new AccessToken(environment.LIVEKIT_API_KEY, environment.LIVEKIT_API_SECRET, {
    identity,
    ttl: '15m',
  });
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
  });

  // Ensure LiveKit agent dispatch exists for voiceflow in this room
  try {
    const roomServiceClient = new RoomServiceClient(
      environment.LIVEKIT_URL,
      environment.LIVEKIT_API_KEY,
      environment.LIVEKIT_API_SECRET,
    );
    const dispatchClient = new AgentDispatchClient(
      environment.LIVEKIT_URL,
      environment.LIVEKIT_API_KEY,
      environment.LIVEKIT_API_SECRET,
    );

    // 1. Check if the VoiceFlow agent is already an active participant in this room
    let agentInRoom = false;
    try {
      const participants = await roomServiceClient.listParticipants(room);
      for (const p of participants) {
        if (
          (p.kind as number) === 0 /* STANDARD */ &&
          p.identity !== identity &&
          (!p.tracks || p.tracks.length === 0)
        ) {
          try {
            await roomServiceClient.removeParticipant(room, p.identity);
            logger.info({ room, staleParticipant: p.identity }, 'Cleaned up stale participant with no tracks');
          } catch {
            // Ignore if participant already disconnected
          }
        }
      }

      agentInRoom = participants.some(
        (p) =>
          (p.kind as number) === 4 /* ParticipantKind.AGENT */ ||
          p.identity.startsWith('agent-') ||
          p.identity === 'voiceflow',
      );
    } catch {
      // Room might not exist yet before first participant connects, which is normal
    }

    if (agentInRoom) {
      logger.info({ room, agentName: 'voiceflow' }, 'Agent worker is already present in room');
    } else {
      // 2. Inspect existing dispatches
      const dispatches = await dispatchClient.listDispatch(room);
      let hasActiveJobOrRecentDispatch = false;
      const now = Date.now();

      for (const d of dispatches) {
        if (d.agentName === 'voiceflow') {
          const jobs = d.state?.jobs ?? [];
          const hasPendingOrRunning = jobs.some((j) => {
            const s = j.state?.status as number | undefined;
            return s === 0 || s === 1; // JS_PENDING or JS_RUNNING
          });

          // Protect freshly created dispatches (within 15 seconds) from immediate deletion race conditions
          const createdAtNs = BigInt(d.state?.createdAt || '0');
          const createdAtMs = Number(createdAtNs / 1000000n);
          const isRecent = createdAtMs > 0 && now - createdAtMs < 15000;

          if (hasPendingOrRunning || isRecent) {
            hasActiveJobOrRecentDispatch = true;
          } else {
            // Clean up genuinely dead dispatches
            try {
              await dispatchClient.deleteDispatch(d.id, room);
            } catch {
              // Non-fatal cleanup
            }
          }
        }
      }

      // 3. Create fresh dispatch only if no active or recent dispatch exists
      if (!hasActiveJobOrRecentDispatch) {
        const created = await dispatchClient.createDispatch(room, 'voiceflow');
        logger.info(
          { room, agentName: 'voiceflow', dispatchId: created.id },
          'Created active agent dispatch for room',
        );
      } else {
        logger.info({ room, agentName: 'voiceflow' }, 'Agent dispatch is already active/pending');
      }
    }
  } catch (err: unknown) {
    logger.warn({ err: (err as Error).message }, 'Agent dispatch check notice');
  }

  sendJson(response, 200, {
    serverUrl: environment.LIVEKIT_URL,
    participantToken: await token.toJwt(),
  });
}

export function startTokenServer(): void {
  const environment = loadTokenServerEnvironment();
  const server = createServer((request, response) => {
    void handleTokenRequest(request, response).catch((error: unknown) => {
      logger.error({ err: error }, 'Token request failed');
      sendJson(response, 500, { error: 'Unable to create token' });
    });
  });

  server.listen(environment.TOKEN_SERVER_PORT, () => {
    logger.info({ port: environment.TOKEN_SERVER_PORT }, 'Token server listening');
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startTokenServer();
}

