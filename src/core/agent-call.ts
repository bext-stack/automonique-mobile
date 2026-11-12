// SPDX-License-Identifier: Elastic-2.0

/**
 * The phone's side of a live call with a persona agent.
 *
 * A call is a WebSocket to the paired server. The first message presents a
 * single-use ticket; after that the phone sends microphone audio and receives
 * the agent's speech, both as 16 kHz 16-bit mono PCM, plus small JSON events.
 *
 * What this module deliberately does not do:
 * - It never stores the ticket, audio or transcript outside memory.
 * - It never treats anything said as an approval. Speech reaches the agent
 *   only as an ordinary follow-up, sent by the server.
 * - It never reconnects by itself. A dropped call ends; the operator calls
 *   again, which needs a fresh ticket and a live credential.
 */

export type AgentCallPhase =
  'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended';

export interface AgentCallLine {
  readonly role: 'operator' | 'agent';
  readonly text: string;
}

export interface AgentCallState {
  readonly phase: AgentCallPhase;
  /** Interim transcript of what the operator is saying now. */
  readonly partial: string;
  /** What was said during this call, newest last. Memory only. */
  readonly lines: readonly AgentCallLine[];
  readonly muted: boolean;
  /** Stable server or local category once the call has ended. */
  readonly endReason: string | null;
}

/** Microphone capture and speech playback, supplied by the platform. */
export interface CallAudioPort {
  /** Begin capture; `onFrame` receives 16 kHz 16-bit mono PCM frames. */
  start(onFrame: (pcm: Uint8Array) => void): Promise<void>;
  /** Queue agent speech for playback. */
  play(pcm: Uint8Array): void;
  /** Drop speech that has not been played yet (the agent was interrupted). */
  flush(): void;
  stop(): Promise<void>;
}

/** The subset of WebSocket a call uses, so tests can supply a fake. */
export interface CallSocket {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(): void;
}

export interface AgentCallOptions {
  /** HTTPS origin of the paired server. */
  readonly origin: string;
  /** Path from the call ticket, always under /api/mobile/. */
  readonly path: string;
  readonly ticket: string;
  /** ISO 639 language of the conversation. */
  readonly language: string;
  readonly audio: CallAudioPort;
  readonly openSocket: (url: string) => CallSocket;
  readonly onState: (state: AgentCallState) => void;
}

export interface AgentCallHandle {
  setMuted(muted: boolean): void;
  hangUp(): void;
}

/** Largest audio frame the server accepts: 200 ms. */
export const MAX_CALL_FRAME_BYTES = 6400;
const MAX_CALL_LINES = 50;
const MAX_LINE_CHARACTERS = 4000;

export const INITIAL_AGENT_CALL_STATE: AgentCallState = {
  phase: 'connecting',
  partial: '',
  lines: [],
  muted: false,
  endReason: null,
};

/**
 * The WebSocket URL of a call. Only a secure origin and a path under
 * /api/mobile/ are admitted, so a ticket can never be sent anywhere else.
 */
export function agentCallUrl(origin: string, path: string): string {
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    !/^\/api\/mobile\/[a-z][a-z-]{0,62}$/u.test(path)
  ) {
    throw new Error('agent_call_endpoint_refused');
  }
  return `wss://${url.host}${path}`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, MAX_LINE_CHARACTERS)
    : null;
}

export function startAgentCall(options: AgentCallOptions): AgentCallHandle {
  let state = INITIAL_AGENT_CALL_STATE;
  let ready = false;
  let finished = false;
  const socket = options.openSocket(agentCallUrl(options.origin, options.path));
  socket.binaryType = 'arraybuffer';

  function publish(next: Partial<AgentCallState>) {
    state = { ...state, ...next };
    options.onState(state);
  }

  function addLine(line: AgentCallLine) {
    publish({
      partial: line.role === 'operator' ? '' : state.partial,
      lines: [...state.lines, line].slice(-MAX_CALL_LINES),
    });
  }

  function finish(reason: string) {
    if (finished) return;
    finished = true;
    publish({ phase: 'ended', partial: '', endReason: reason });
    void options.audio.stop().catch(() => undefined);
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  }

  socket.onopen = () => {
    socket.send(
      JSON.stringify({
        type: 'hello',
        ticket: options.ticket,
        language: options.language,
      }),
    );
  };

  socket.onmessage = (event) => {
    if (finished) return;
    if (typeof event.data !== 'string') {
      // Agent speech. Anything received before the server said the call is
      // ready, or in an unexpected shape, is not played.
      if (ready && event.data instanceof ArrayBuffer) {
        options.audio.play(new Uint8Array(event.data));
      }
      return;
    }
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (parsed === null || typeof parsed !== 'object') return;
      message = parsed as Record<string, unknown>;
    } catch {
      return finish('agent_call_protocol_invalid');
    }
    switch (message.type) {
      case 'ready':
        if (message.sample_rate !== 16000) {
          return finish('agent_call_protocol_invalid');
        }
        ready = true;
        options.audio
          .start((pcm) => {
            if (
              finished ||
              state.muted ||
              pcm.byteLength === 0 ||
              pcm.byteLength > MAX_CALL_FRAME_BYTES ||
              pcm.byteLength % 2 !== 0
            ) {
              return;
            }
            socket.send(pcm);
          })
          .catch(() => finish('agent_call_microphone_unavailable'));
        return;
      case 'state':
        if (
          message.state === 'listening' ||
          message.state === 'thinking' ||
          message.state === 'speaking'
        ) {
          publish({ phase: message.state });
        }
        return;
      case 'partial':
        publish({ partial: text(message.text) ?? '' });
        return;
      case 'heard': {
        const heard = text(message.text);
        if (heard !== null) addLine({ role: 'operator', text: heard });
        return;
      }
      case 'agent': {
        const said = text(message.text);
        if (said !== null) addLine({ role: 'agent', text: said });
        return;
      }
      case 'interrupted':
        options.audio.flush();
        return;
      case 'ended':
        return finish(text(message.reason) ?? 'agent_call_ended');
      default:
        // An event this build does not know is not an error.
        return;
    }
  };

  socket.onerror = () => finish('agent_call_connection_failed');
  socket.onclose = () => finish('agent_call_connection_closed');

  return {
    setMuted(muted) {
      if (finished || state.muted === muted) return;
      publish({ muted });
      if (ready) socket.send(JSON.stringify({ type: 'mute', muted }));
    },
    hangUp() {
      if (finished) return;
      if (ready) {
        try {
          socket.send(JSON.stringify({ type: 'hangup' }));
        } catch {
          // The server learns from the close instead.
        }
      }
      finish('hung_up');
    },
  };
}
