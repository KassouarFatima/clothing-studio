import { useEffect, useRef, useState } from 'react';
import config from '../config/config';
import state from '../store';

const CHAT_URL = config[import.meta.env.DEV ? 'development' : 'production'].chatUrl;

const WELCOME = "Salam! 👋 I'm your design assistant. Ask me anything in Darija, العربية, English or Français — colors, styles, or a full-shirt pattern.";

const CHIPS = [
  'Suggest a design for me',
  'عاونيني نصمم تيشيرت مليح',
  'صمّم لي قميصاً من فضلك',
  'Best colors for a sporty shirt',
];

// Arabic text must read right-to-left, or the bubbles look broken.
const ARABIC_TEXT = /[؀-ۿ]/;

const MAX_HISTORY = 10;
let nextId = 1;

// The assistant marks the pattern brief with "#design: ..." so it can be sent
// straight to the AI designer instead of copied by hand.
function splitReply(reply) {
  const match = reply.match(/^\s*#design:\s*(.+)$/mi);
  const text = reply
    .replace(/^\s*#design:.*$/mi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, design: match ? match[1].trim() : null };
}

export default function ChatBot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([
    { id: 0, role: 'assistant', text: WELCOME },
  ]);
  const sendingRef = useRef(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, open, sending]);

  const send = async (override) => {
    const text = typeof override === 'string' ? override.trim() : input.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError('');
    const userMessage = { id: nextId++, role: 'user', text };
    const history = [...messages, userMessage]
      .slice(-MAX_HISTORY)
      .filter(message => message.text)
      .map(message => ({ role: message.role, content: message.text }));
    setMessages(previous => [...previous, userMessage]);
    if (typeof override !== 'string') setInput('');
    try {
      const response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof data?.message === 'string'
          ? data.message
          : `The assistant is unavailable (${response.status}). Please try again.`);
      }
      if (typeof data?.reply !== 'string' || !data.reply.trim()) {
        throw new Error('The assistant returned an empty reply. Please try again.');
      }
      const { text: replyText, design } = splitReply(data.reply);
      setMessages(previous => [...previous, {
        id: nextId++,
        role: 'assistant',
        text: replyText,
        design,
        offline: data.source === 'local',
      }]);
    } catch (failure) {
      // Return the message to the composer so a retry does not duplicate it.
      setMessages(previous => previous.filter(message => message.id !== userMessage.id));
      if (typeof override !== 'string') setInput(text);
      setError(failure instanceof TypeError
        ? 'Could not reach the assistant server. Make sure the backend is running.'
        : failure.message || 'The assistant failed. Please try again.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const applyDesign = (design) => {
    state.pendingDesignPrompt = design;
    state.intro = false;
    setOpen(false);
  };

  const hasAsked = messages.some(message => message.role === 'user');
  const idle = !sending;

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(value => !value)}
        aria-label={open ? 'Close the design assistant' : 'Open the design assistant'}
        aria-expanded={open}
        className='fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-xl transition-transform hover:scale-105 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-300'
      >
        {open ? (
          <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' aria-hidden='true'>
            <path d='M6 6l12 12M18 6L6 18' />
          </svg>
        ) : (
          <svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
            <path d='M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' />
          </svg>
        )}
      </button>

      {open && (
        <div
          role='dialog'
          aria-label='Design assistant'
          className='fixed bottom-24 right-5 z-40 flex h-[min(520px,calc(100dvh-140px))] w-[min(360px,calc(100vw-40px))] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl'
        >
          <div className='flex items-center justify-between bg-indigo-600 px-4 py-3 text-white'>
            <div>
              <p className='text-sm font-bold leading-tight'>Design Assistant</p>
              <p className='text-[11px] text-indigo-200'>Darija · العربية · English · Français</p>
            </div>
            <button
              type='button'
              onClick={() => setOpen(false)}
              aria-label='Close the design assistant'
              className='rounded-full p-1.5 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-300'
            >
              <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' aria-hidden='true'>
                <path d='M6 6l12 12M18 6L6 18' />
              </svg>
            </button>
          </div>

          <div className='flex flex-1 flex-col space-y-2 overflow-y-auto bg-gray-50 p-3' role='log' aria-live='polite'>
            {messages.map(message => (
              <div
                key={message.id}
                dir={ARABIC_TEXT.test(message.text) ? 'rtl' : undefined}
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  message.role === 'user'
                    ? 'self-end rounded-br-sm bg-indigo-600 text-white'
                    : 'self-start rounded-bl-sm border border-gray-200 bg-white text-gray-800'
                }`}
              >
                {message.text}
                {message.role === 'assistant' && !message.text && message.design && (
                  <span className='text-gray-500'>Design ready ✨</span>
                )}
                {message.design && (
                  <button
                    type='button'
                    onClick={() => applyDesign(message.design)}
                    className='mt-2 block w-full rounded-lg bg-indigo-50 px-2 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-300'
                  >
                    🎨 Use this design in the designer →
                  </button>
                )}
                {message.offline && (
                  <span className='mt-1 block text-[10px] text-gray-400' title='The AI service was unreachable, so this answer came from the local assistant.'>
                    offline
                  </span>
                )}
              </div>
            ))}
            {sending && (
              <div className='self-start rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-3 py-2.5 shadow-sm' aria-hidden='true'>
                <span className='inline-flex gap-1'>
                  <span className='h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400' style={{ animationDelay: '0ms' }} />
                  <span className='h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400' style={{ animationDelay: '150ms' }} />
                  <span className='h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-400' style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {!hasAsked && (
            <div className='flex flex-wrap gap-1.5 bg-gray-50 px-3 pb-2'>
              {CHIPS.map(chip => (
                <button
                  key={chip}
                  type='button'
                  disabled={!idle}
                  onClick={() => send(chip)}
                  className='rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-300'
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          {error && (
            <p role='alert' className='border-t border-red-100 bg-red-50 px-3 py-1.5 text-xs text-red-700'>
              {error}
            </p>
          )}

          <div className='flex items-end gap-2 border-t border-gray-200 bg-white p-2'>
            <textarea
              rows={1}
              value={input}
              disabled={!idle}
              aria-label='Message the design assistant'
              placeholder='Describe your idea — Darija, العربية, English…'
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              className='max-h-24 min-h-[38px] flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300'
            />
            <button
              type='button'
              onClick={() => send()}
              disabled={!idle || !input.trim()}
              aria-label='Send message'
              className='flex h-[38px] w-[38px] items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-indigo-300'
            >
              <svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                <path d='M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z' />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
