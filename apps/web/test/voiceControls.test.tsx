import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AudioUnlock, MicButton, VoiceBadge, micView } from '../src/ui/VoiceControls';
import type { MicState, VoicePeer } from '../src/services/voice';
import en from '../src/i18n/en.json';
import fa from '../src/i18n/fa.json';
import ar from '../src/i18n/ar.json';

const peer = (extra: Partial<VoicePeer> = {}): VoicePeer => ({
  id: 'them',
  name: 'Ben',
  connected: true,
  speaking: false,
  microphone: true,
  silenced: false,
  mutedByServer: false,
  ...extra,
});

const lookup = (dict: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], dict);

describe('voice controls', () => {
  it('maps every microphone state to a label, pressed state and availability', () => {
    const cases: [MicState, boolean, boolean][] = [
      ['off', false, false],
      ['on', true, false],
      ['pending', false, true],
      ['denied', false, false],
      ['blocked', false, true],
    ];
    for (const [mic, pressed, disabled] of cases) {
      const view = micView(mic);
      expect(view.pressed).toBe(pressed);
      expect(view.disabled).toBe(disabled);
      for (const dict of [en, fa, ar]) expect(typeof lookup(dict, view.label)).toBe('string');
    }
  });

  it('renders the mic button muted by default and pressed when on', () => {
    const off = renderToStaticMarkup(<MicButton mic="off" speaking={false} onToggle={() => undefined} />);
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('voice-mic--off');
    expect(off).toContain('voice.micOff');
    const on = renderToStaticMarkup(<MicButton mic="on" speaking onToggle={() => undefined} />);
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('is-speaking');
    const blocked = renderToStaticMarkup(<MicButton mic="blocked" speaking={false} onToggle={() => undefined} />);
    expect(blocked).toContain('disabled=""');
  });

  it('marks a speaking or silenced player and nothing for a quiet or absent one', () => {
    expect(renderToStaticMarkup(<VoiceBadge peer={peer({ speaking: true })} />)).toContain('data-state="speaking"');
    expect(renderToStaticMarkup(<VoiceBadge peer={peer({ speaking: true, silenced: true })} />)).toContain(
      'data-state="silenced"',
    );
    expect(renderToStaticMarkup(<VoiceBadge peer={peer()} />)).toBe('');
    expect(renderToStaticMarkup(<VoiceBadge peer={peer({ connected: false, speaking: true })} />)).toBe('');
    expect(renderToStaticMarkup(<VoiceBadge peer={null} />)).toBe('');
  });

  it('renders the tap-to-hear notice with a string in every language', () => {
    const html = renderToStaticMarkup(<AudioUnlock onUnlock={() => undefined} />);
    expect(html).toContain('voice-unlock');
    expect(html).toContain('type="button"');
    expect(html).toContain('voice.audioBlocked');
    for (const dict of [en, fa, ar]) expect(typeof lookup(dict, 'voice.audioBlocked')).toBe('string');
  });
});
