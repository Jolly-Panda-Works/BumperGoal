export type MessageTone = 'info' | 'success' | 'warning' | 'error';
export interface Message {
  id: number;
  text: string;
  tone: MessageTone;
  action?: { label: string; run: () => void };
}
let messages: Message[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export const messageStore = {
  get: () => messages,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  dismiss(id: number) {
    messages = messages.filter((message) => message.id !== id);
    emit();
  },
};
/** A dismissible queue shared by all application messages. */
export function showMessage(text: string, tone: MessageTone = 'info', action?: Message['action']): void {
  if (!text.trim() || messages.some((message) => message.text === text && message.tone === tone)) return;
  messages = [...messages, { id: nextId++, text, tone, action }];
  emit();
}
