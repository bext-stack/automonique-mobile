// SPDX-License-Identifier: Elastic-2.0

import {
  agentCallUrl,
  MAX_CALL_FRAME_BYTES,
  startAgentCall,
  type AgentCallState,
  type CallAudioPort,
  type CallSocket,
} from './agent-call';

class FakeSocket implements CallSocket {
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: unknown[] = [];
  closed = false;
  constructor(readonly url: string) {}
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  receive(message: unknown) {
    this.onmessage?.({
      data: message instanceof ArrayBuffer ? message : JSON.stringify(message),
    });
  }
}

function setup() {
  const states: AgentCallState[] = [];
  const played: number[] = [];
  let flushed = 0;
  let stopped = 0;
  let frame: ((pcm: Uint8Array) => void) | null = null;
  const audio: CallAudioPort = {
    start: async (onFrame) => {
      frame = onFrame;
    },
    play: (pcm) => played.push(pcm.byteLength),
    flush: () => {
      flushed += 1;
    },
    stop: async () => {
      stopped += 1;
    },
  };
  let socket!: FakeSocket;
  const handle = startAgentCall({
    origin: 'https://ops.example.test',
    path: '/api/mobile/call',
    ticket: 'ab'.repeat(32),
    language: 'fr',
    audio,
    openSocket: (url) => (socket = new FakeSocket(url)),
    onState: (state) => states.push(state),
  });
  return {
    handle,
    socket,
    states,
    played,
    last: () => states.at(-1),
    flushed: () => flushed,
    stopped: () => stopped,
    speak: (bytes: number) => frame?.(new Uint8Array(bytes)),
    capturing: () => frame !== null,
  };
}

const ready = { type: 'ready', sample_rate: 16000 };

describe('agentCallUrl', () => {
  it('admits only a secure paired origin and a mobile path', () => {
    expect(agentCallUrl('https://ops.example.test', '/api/mobile/call')).toBe(
      'wss://ops.example.test/api/mobile/call',
    );
    for (const [origin, path] of [
      ['http://ops.example.test', '/api/mobile/call'],
      ['https://user:pw@ops.example.test', '/api/mobile/call'],
      ['https://ops.example.test/base', '/api/mobile/call'],
      ['https://ops.example.test', '/api/platform'],
      ['https://ops.example.test', '//attacker.test/api/mobile/call'],
      ['https://ops.example.test', '/api/mobile/../platform'],
      ['https://ops.example.test', '/api/mobile/call?x=1'],
    ] as const) {
      expect(() => agentCallUrl(origin, path)).toThrow(
        'agent_call_endpoint_refused',
      );
    }
  });
});

describe('startAgentCall', () => {
  it('presents the ticket first and captures only once the server is ready', async () => {
    const call = setup();
    expect(call.socket.url).toBe('wss://ops.example.test/api/mobile/call');
    call.socket.onopen?.();
    expect(call.socket.sent).toEqual([
      JSON.stringify({
        type: 'hello',
        ticket: 'ab'.repeat(32),
        language: 'fr',
      }),
    ]);
    expect(call.capturing()).toBe(false);
    // Audio before `ready` is never played.
    call.socket.receive(new ArrayBuffer(320));
    expect(call.played).toEqual([]);
    call.socket.receive(ready);
    await Promise.resolve();
    expect(call.capturing()).toBe(true);
    // The ticket is not kept anywhere in the published state.
    expect(JSON.stringify(call.states)).not.toContain('abab');
  });

  it('follows one spoken turn and keeps the transcript in memory', async () => {
    const call = setup();
    call.socket.onopen?.();
    call.socket.receive(ready);
    await Promise.resolve();
    call.socket.receive({ type: 'state', state: 'listening' });
    call.speak(640);
    expect(call.socket.sent.at(-1)).toBeInstanceOf(Uint8Array);
    call.socket.receive({ type: 'partial', text: 'bonjour' });
    expect(call.last()?.partial).toBe('bonjour');
    call.socket.receive({ type: 'heard', text: 'bonjour Monique' });
    call.socket.receive({ type: 'state', state: 'thinking' });
    call.socket.receive({ type: 'agent', text: 'Tout va bien.' });
    call.socket.receive({ type: 'state', state: 'speaking' });
    call.socket.receive(new ArrayBuffer(320));
    expect(call.last()).toMatchObject({
      phase: 'speaking',
      partial: '',
      lines: [
        { role: 'operator', text: 'bonjour Monique' },
        { role: 'agent', text: 'Tout va bien.' },
      ],
    });
    expect(call.played).toEqual([320]);
  });

  it('drops unplayed speech when the agent is interrupted', async () => {
    const call = setup();
    call.socket.onopen?.();
    call.socket.receive(ready);
    await Promise.resolve();
    call.socket.receive({ type: 'interrupted' });
    expect(call.flushed()).toBe(1);
  });

  it('sends nothing from a muted microphone or a malformed frame', async () => {
    const call = setup();
    call.socket.onopen?.();
    call.socket.receive(ready);
    await Promise.resolve();
    const before = call.socket.sent.length;
    for (const bytes of [0, 3, MAX_CALL_FRAME_BYTES + 2]) call.speak(bytes);
    expect(call.socket.sent.length).toBe(before);
    call.handle.setMuted(true);
    expect(call.socket.sent.at(-1)).toBe(
      JSON.stringify({ type: 'mute', muted: true }),
    );
    call.speak(640);
    expect(call.socket.sent.length).toBe(before + 1);
    call.handle.setMuted(false);
    call.speak(640);
    expect(call.socket.sent.at(-1)).toBeInstanceOf(Uint8Array);
  });

  it('ends once, with the server reason, and releases the microphone', async () => {
    const call = setup();
    call.socket.onopen?.();
    call.socket.receive(ready);
    await Promise.resolve();
    call.socket.receive({ type: 'ended', reason: 'mobile_credential_invalid' });
    call.socket.onclose?.();
    call.handle.hangUp();
    expect(call.last()).toMatchObject({
      phase: 'ended',
      endReason: 'mobile_credential_invalid',
    });
    expect(call.stopped()).toBe(1);
    expect(call.socket.closed).toBe(true);
    // Nothing is sent or played after the end.
    const sent = call.socket.sent.length;
    call.speak(640);
    call.socket.receive(new ArrayBuffer(320));
    expect(call.socket.sent.length).toBe(sent);
    expect(call.played).toEqual([]);
  });

  it('hangs up, reports a dropped connection, and refuses a wrong sample rate', async () => {
    const hung = setup();
    hung.socket.onopen?.();
    hung.socket.receive(ready);
    await Promise.resolve();
    hung.handle.hangUp();
    expect(hung.socket.sent.at(-1)).toBe(JSON.stringify({ type: 'hangup' }));
    expect(hung.last()?.endReason).toBe('hung_up');

    const dropped = setup();
    dropped.socket.onerror?.();
    expect(dropped.last()?.endReason).toBe('agent_call_connection_failed');

    const wrongRate = setup();
    wrongRate.socket.receive({ type: 'ready', sample_rate: 48000 });
    expect(wrongRate.last()?.endReason).toBe('agent_call_protocol_invalid');
    expect(wrongRate.capturing()).toBe(false);
  });

  it('ignores events it does not know and caps what it keeps', async () => {
    const call = setup();
    call.socket.onopen?.();
    call.socket.receive(ready);
    await Promise.resolve();
    call.socket.receive({ type: 'future_event', anything: true });
    call.socket.receive({ type: 'state', state: 'approving' });
    expect(call.last()).toBeUndefined();
    for (let index = 0; index < 60; index += 1) {
      call.socket.receive({ type: 'agent', text: `line ${index}` });
    }
    expect(call.last()?.lines).toHaveLength(50);
    expect(call.last()?.lines[0]?.text).toBe('line 10');
  });
});
