import { useEffect } from 'react';

import { ApiError, apiFetch } from './apiClient';
import { getSessionToken, notifySessionExpired } from './session';

type TripEventFrame = { event: string; id: string | null; data: string };

export function parseSseFrame(block: string): TripEventFrame | null {
  let event = 'message';
  let id: string | null = null;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    if (field === 'id' && !value.includes('\0')) id = value;
    if (field === 'data') data.push(value);
  }
  if (!data.length && !id && event === 'message') return null;
  return { event, id, data: data.join('\n') };
}

function waitForReconnect(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = window.setTimeout(done, delay);
    function done() {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

async function readTripEventStream(
  response: Response,
  tripId: string,
  signal: AbortSignal,
  onChange: () => void,
  setCursor: (cursor: string) => void,
) {
  if (!response.body) throw new Error('Trip event stream is unavailable.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = false;

  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const frame = parseSseFrame(block);
      if (!frame) continue;
      if (frame.id) {
        setCursor(frame.id);
        sessionStorage.setItem(`tripledger-event-cursor:${tripId}`, frame.id);
      }
      if (frame.event === 'ready' || frame.event === 'trip-change') onChange();
      if (frame.event === 'session-expired') {
        notifySessionExpired();
        terminal = true;
        break;
      }
      if (frame.event === 'access-revoked') {
        terminal = true;
        break;
      }
    }
    if (terminal) break;
  }
  await reader.cancel().catch(() => undefined);
  return terminal;
}

export function useTripEvents(tripId: string, onChange: () => void) {
  useEffect(() => {
    if (!tripId || !getSessionToken()) return undefined;
    let active = true;
    let cursor = sessionStorage.getItem(`tripledger-event-cursor:${tripId}`) ?? '';
    const lifecycle = new AbortController();

    async function connect() {
      let delay = 1_000;
      while (active && !lifecycle.signal.aborted) {
        const request = new AbortController();
        const abortRequest = () => request.abort();
        lifecycle.signal.addEventListener('abort', abortRequest, { once: true });
        try {
          const response = await apiFetch(`/api/trips/${tripId}/events`, {
            headers: {
              Accept: 'text/event-stream',
              ...(cursor ? { 'Last-Event-ID': cursor } : {}),
            },
            signal: request.signal,
          });
          if (!response.ok) {
            if (response.status === 401 || response.status === 403 || response.status === 400) return;
            throw new ApiError('Live trip updates are temporarily unavailable.', response.status);
          }
          delay = 1_000;
          const terminal = await readTripEventStream(response, tripId, request.signal, onChange, (value) => {
            cursor = value;
          });
          if (terminal) return;
        } catch (error) {
          if (!active || lifecycle.signal.aborted) return;
          if (error instanceof ApiError && error.status === 401) return;
        } finally {
          lifecycle.signal.removeEventListener('abort', abortRequest);
        }
        if (!active || lifecycle.signal.aborted) return;
        await waitForReconnect(delay + Math.floor(Math.random() * Math.min(delay, 500)), lifecycle.signal);
        delay = Math.min(30_000, delay * 2);
      }
    }

    void connect();
    return () => {
      active = false;
      lifecycle.abort();
    };
  }, [onChange, tripId]);
}
