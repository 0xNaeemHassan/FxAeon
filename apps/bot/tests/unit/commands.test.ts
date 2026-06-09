import { describe, it, expect, vi } from 'vitest';
import startHandler from '../../src/commands/start';
import helpHandler from '../../src/commands/help';

describe('Command Handlers', () => {
  const mockCtx = {
    reply: vi.fn(),
    from: { id: 123456, username: 'testuser' },
  } as any;

  it('start handler should reply with welcome message', async () => {
    await startHandler(mockCtx);
    expect(mockCtx.reply).toHaveBeenCalled();
    const call = mockCtx.reply.mock.calls[0];
    expect(call[0]).toContain('Welcome');
  });

  it('help handler should reply with help text', async () => {
    await helpHandler(mockCtx);
    expect(mockCtx.reply).toHaveBeenCalled();
    const call = mockCtx.reply.mock.calls[0];
    expect(call[0]).toContain('Help');
  });
});
