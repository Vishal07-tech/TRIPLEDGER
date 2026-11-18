import { describe, expect, it } from 'vitest';

import { parseSseFrame } from './useTripEvents';

describe('trip event stream parsing', () => {
  it('parses event cursor and data fields without exposing extra stream content', () => {
    expect(parseSseFrame('id: 12\nevent: trip-change\ndata: {"type":"TRIP_EXPENSE_CREATED"}')).toEqual({
      id: '12',
      event: 'trip-change',
      data: '{"type":"TRIP_EXPENSE_CREATED"}',
    });
  });

  it('joins multiline data and ignores keepalive comments', () => {
    expect(parseSseFrame('event: ready\ndata: first\ndata: second')).toEqual({
      id: null,
      event: 'ready',
      data: 'first\nsecond',
    });
    expect(parseSseFrame(': keepalive')).toBeNull();
  });
});
