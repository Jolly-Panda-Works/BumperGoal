import { afterEach, expect, it } from 'vitest';
import { messageStore, showMessage } from '../src/ui/messages';

afterEach(() => {
  for (const message of messageStore.get()) messageStore.dismiss(message.id);
});

it('queues all message tones and keeps messages until explicitly dismissed', () => {
  for (const tone of ['error', 'warning', 'success', 'info'] as const) showMessage(tone, tone);
  expect(messageStore.get().map((message) => message.tone)).toEqual(['error', 'warning', 'success', 'info']);
  messageStore.dismiss(messageStore.get()[0]!.id);
  expect(messageStore.get()[0]!.tone).toBe('warning');
});

it('coalesces duplicate pending messages but permits a new attempt after dismissal', () => {
  showMessage('Unavailable', 'error');
  showMessage('Unavailable', 'error');
  expect(messageStore.get()).toHaveLength(1);
  messageStore.dismiss(messageStore.get()[0]!.id);
  showMessage('Unavailable', 'error');
  expect(messageStore.get()).toHaveLength(1);
});
