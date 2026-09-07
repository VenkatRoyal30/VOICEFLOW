import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';

interface ServerlessRequest extends IncomingMessage {
  query?: Record<string, string | string[]>;
}

interface ServerlessResponse extends ServerResponse {
  status?: (code: number) => ServerlessResponse;
  json?: (body: unknown) => void;
}

function sendJson(
  response: ServerlessResponse,
  statusCode: number,
  body: unknown,
): void {
  if (typeof response.status === 'function' && typeof response.json === 'function') {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.status(statusCode);
    response.json(body);
  } else {
    response.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    });
    response.end(JSON.stringify(body));
  }
}

export default async function handler(
  request: ServerlessRequest,
  response: ServerlessResponse,
): Promise<void> {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    });
    response.end();
    return;
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  // Parse room and identity from Vercel req.query or standard request.url
  const requestUrl = new URL(request.url ?? '/', 'http://localhost');
  const queryRoom = request.query?.room;
  const queryIdentity = request.query?.identity;

  const room =
    (typeof queryRoom === 'string'
      ? queryRoom
      : Array.isArray(queryRoom)
        ? queryRoom[0]
        : null) ?? requestUrl.searchParams.get('room');

  const identity =
    (typeof queryIdentity === 'string'
      ? queryIdentity
      : Array.isArray(queryIdentity)
        ? queryIdentity[0]
        : null) ?? requestUrl.searchParams.get('identity');

  if (!room || !identity) {
    sendJson(response, 400, {
      error: 'room and identity are required query parameters',
    });
    return;
  }

  // Read credentials ONLY from server-side environment variables
  const livekitUrl = process.env.LIVEKIT_URL;
  const livekitApiKey = process.env.LIVEKIT_API_KEY;
  const livekitApiSecret = process.env.LIVEKIT_API_SECRET;

  if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
    sendJson(response, 500, {
      error:
        'Missing required server credentials: LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET',
    });
    return;
  }

  // Generate short-lived participant access token
  const token = new AccessToken(livekitApiKey, livekitApiSecret, {
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
      livekitUrl,
      livekitApiKey,
      livekitApiSecret,
    );
    const dispatchClient = new AgentDispatchClient(
      livekitUrl,
      livekitApiKey,
      livekitApiSecret,
    );

    // 1. Check if the VoiceFlow agent is already active in the room
    let hasActiveJobOrRecentDispatch = false;

    // 1. Inspect existing dispatches if room exists
    try {
      const dispatches = await dispatchClient.listDispatch(room);
      const now = Date.now();

      for (const d of dispatches) {
        if (d.agentName === 'voiceflow') {
          const jobs = d.state?.jobs ?? [];
          const hasPendingOrRunning = jobs.some((j: { state?: { status?: unknown } }) => {
            const s = j.state?.status as number | undefined;
            return s === 0 || s === 1; // JS_PENDING or JS_RUNNING
          });

          // Protect freshly created dispatches (within 15 seconds) from deletion race conditions
          const createdAtNs = BigInt(d.state?.createdAt || '0');
          const createdAtMs = Number(createdAtNs / 1000000n);
          const isRecent = createdAtMs > 0 && now - createdAtMs < 15000;

          if (hasPendingOrRunning || isRecent) {
            hasActiveJobOrRecentDispatch = true;
          } else {
            try {
              await dispatchClient.deleteDispatch(d.id, room);
            } catch {
              // Non-fatal cleanup
            }
          }
        }
      }
    } catch {
      // Room does not exist yet (404), perfectly normal
    }

    // 2. Clean up stale/zombie agent participants if no active dispatch
    if (!hasActiveJobOrRecentDispatch) {
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
            } catch {
              // Ignore
            }
          }
        }

        const agentParticipants = participants.filter(
          (p) =>
            (p.kind as number) === 4 /* ParticipantKind.AGENT */ ||
            p.identity.startsWith('agent-') ||
            p.identity === 'voiceflow',
        );
        for (const ap of agentParticipants) {
          try {
            await roomServiceClient.removeParticipant(room, ap.identity);
          } catch {
            // Ignore
          }
        }
      } catch {
        // Room does not exist yet, normal
      }
    }

    // 3. Create fresh dispatch if no active or recent dispatch exists
    if (!hasActiveJobOrRecentDispatch) {
      try {
        await dispatchClient.createDispatch(room, 'voiceflow');
      } catch (err: unknown) {
        console.warn('createDispatch notice:', (err as Error).message);
      }
    }
  } catch (err: unknown) {
    console.warn('Agent dispatch check notice:', (err as Error).message);
  }

  // Return serverUrl and participantToken. Never expose apiKey or apiSecret.
  const participantToken = await token.toJwt();
  sendJson(response, 200, {
    serverUrl: livekitUrl,
    participantToken,
  });
}
