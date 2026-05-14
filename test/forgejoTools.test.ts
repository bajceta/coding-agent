import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';

// Save original env
const originalEnv = { ...process.env };

// Use globalThis to share mock state with the vi.mock closure
// (vi.mock is hoisted and may not capture module-level vars correctly)
(globalThis as any).__mockExecHandler = null;

vi.mock('util', () => ({
    promisify: (fn: Function) => {
        return (...args: any[]) =>
            new Promise((resolve, reject) => {
                fn(...args, (err: Error | null, stdout: string, stderr: string) => {
                    if (err) reject(err);
                    else resolve({ stdout, stderr });
                });
            });
    },
}));

vi.mock('child_process', () => {
    function mockExec(cmd: string, opts: any, cb: any) {
        // Handle both exec(cmd, cb) and exec(cmd, opts, cb) signatures
        let actualCb: any;
        if (typeof opts === 'function') {
            actualCb = opts;
        } else {
            actualCb = cb;
        }

        const mockExecHandler = (globalThis as any).__mockExecHandler;
        if (mockExecHandler && actualCb) {
            const result = mockExecHandler(cmd);
            if (result.error) {
                const err: any = new Error(result.error);
                err.stderr = result.stderr || '';
                actualCb(err, result.stdout || '', err.stderr);
            } else {
                actualCb(null, result.stdout || '', result.stderr || '');
            }
        } else if (actualCb) {
            actualCb(null, '', '');
        }
        return { on: () => {} } as any;
    }
    return { exec: mockExec };
});

// Default mock: returns a valid git remote so detectRepo works
const defaultMockHandler = (cmd: string) => {
    if (cmd.includes('git remote')) {
        return { stdout: 'origin\thttps://forgejo.test/testowner/testrepo.git (fetch)' };
    }
    return { stdout: '' };
};

describe('Forgejo Tools', () => {
    beforeEach(() => {
        (globalThis as any).__mockExecHandler = defaultMockHandler;
    });

    afterAll(() => {
        process.env.FORGEJO_URL = originalEnv.FORGEJO_URL;
        process.env.FORGEJO_TOKEN = originalEnv.FORGEJO_TOKEN;
        vi.restoreAllMocks();
        (globalThis as any).__mockExecHandler = null;
    });

    describe('Tool Structure', () => {
        it('forgejoPickTicket has correct structure', async () => {
            const pickTicket = await import('../src/tools/forgejoPickTicket.ts');
            expect(pickTicket.default.enabled).toBe(true);
            expect(pickTicket.default.description).toBeDefined();
            expect(pickTicket.default.arguments).toBeDefined();
            expect(typeof pickTicket.default.execute).toBe('function');
        });

        it('forgejoCreatePR has correct structure', async () => {
            const createPR = await import('../src/tools/forgejoCreatePR.ts');
            expect(createPR.default.enabled).toBe(false);
            expect(createPR.default.description).toBeDefined();
            expect(createPR.default.arguments).toBeDefined();
            expect(typeof createPR.default.execute).toBe('function');
        });

        it('forgejoGetPRComments has correct structure', async () => {
            const getPRComments = await import('../src/tools/forgejoGetPRComments.ts');
            expect(getPRComments.default.enabled).toBe(true);
            expect(getPRComments.default.description).toBeDefined();
            expect(getPRComments.default.arguments).toBeDefined();
            expect(typeof getPRComments.default.execute).toBe('function');
        });
    });

    describe('Missing Env Vars', () => {
        beforeAll(() => {
            delete process.env.FORGEJO_URL;
            delete process.env.FORGEJO_TOKEN;
        });

        it('forgejoPickTicket fails without env vars', async () => {
            (globalThis as any).__mockExecHandler = (cmd: string) => {
                console.log('DEBUG mock called:', cmd.substring(0, 60));
                if (cmd.includes('git remote')) {
                    return {
                        stdout: 'origin\thttps://forgejo.test/testowner/testrepo.git (fetch)',
                    };
                }
                return { stdout: '' };
            };
            const pickTicket = await import('../src/tools/forgejoPickTicket.ts');
            const result = await pickTicket.default.execute('testowner/testrepo');
            expect(result.success).toBe(false);
            expect(result.error).toContain('FORGEJO_URL and FORGEJO_TOKEN');
        });

        it('forgejoCreatePR fails without env vars', async () => {
            (globalThis as any).__mockExecHandler = (cmd: string) => {
                console.log('DEBUG mock called:', cmd.substring(0, 60));
                if (cmd.includes('git remote')) {
                    return {
                        stdout: 'origin\thttps://forgejo.test/testowner/testrepo.git (fetch)',
                    };
                }
                return { stdout: '' };
            };
            const createPR = await import('../src/tools/forgejoCreatePR.ts');
            const result = await createPR.default.execute('1', 'testowner/testrepo');
            expect(result.success).toBe(false);
            expect(result.error).toContain('FORGEJO_URL and FORGEJO_TOKEN');
        });

        it('forgejoGetPRComments fails without env vars', async () => {
            (globalThis as any).__mockExecHandler = (cmd: string) => {
                console.log('DEBUG mock called:', cmd.substring(0, 60));
                if (cmd.includes('git remote')) {
                    return {
                        stdout: 'origin\thttps://forgejo.test/testowner/testrepo.git (fetch)',
                    };
                }
                return { stdout: '' };
            };
            const getPRComments = await import('../src/tools/forgejoGetPRComments.ts');
            const result = await getPRComments.default.execute('1', 'testowner/testrepo');
            expect(result.success).toBe(false);
            expect(result.error).toContain('FORGEJO_URL and FORGEJO_TOKEN');
        });
    });

    describe('Invalid Args', () => {
        beforeAll(() => {
            process.env.FORGEJO_URL = 'http://fake';
            process.env.FORGEJO_TOKEN = 'fake';
        });

        it('forgejoPickTicket fails with invalid repo format', async () => {
            const pickTicket = await import('../src/tools/forgejoPickTicket.ts');
            const result = await pickTicket.default.execute('invalid-repo-format');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid repo format');
        });

        it('forgejoCreatePR fails with invalid issue number', async () => {
            (globalThis as any).__mockExecHandler = (cmd: string) => {
                console.log('DEBUG mock called:', cmd.substring(0, 60));
                if (cmd.includes('git remote')) {
                    return {
                        stdout: 'origin\thttps://forgejo.test/testowner/testrepo.git (fetch)',
                    };
                }
                return { stdout: '' };
            };
            const createPR = await import('../src/tools/forgejoCreatePR.ts');
            const result = await createPR.default.execute('not-a-number', 'testowner/testrepo');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid issue number');
        });

        it('forgejoGetPRComments fails with invalid PR number', async () => {
            (globalThis as any).__mockExecHandler = (cmd: string) => {
                console.log('DEBUG mock called:', cmd.substring(0, 60));
                if (cmd.includes('git remote')) {
                    return {
                        stdout: 'origin\thttps://forgejo.test/testowner/testrepo.git (fetch)',
                    };
                }
                return { stdout: '' };
            };
            const getPRComments = await import('../src/tools/forgejoGetPRComments.ts');
            const result = await getPRComments.default.execute(
                'not-a-number',
                'testowner/testrepo',
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid PR number');
        });
    });

    describe('forgejoGetPRComments Happy Path', () => {
        beforeAll(() => {
            process.env.FORGEJO_URL = 'http://forgejo.test';
            process.env.FORGEJO_TOKEN = 'test-token';
        });

        it('returns formatted comments for a PR', async () => {
            vi.resetModules();
            (globalThis as any).__mockExecHandler = (cmd: string) => {
                console.log('DEBUG mock called:', cmd.substring(0, 60));
                if (cmd.includes('git remote')) {
                    return {
                        stdout: 'origin\thttps://forgejo.test/testowner/testrepo.git (fetch)',
                    };
                }
                if (
                    cmd.includes('/pulls/1') &&
                    !cmd.includes('/issues') &&
                    !cmd.includes('/comments') &&
                    !cmd.includes('/reviews')
                ) {
                    return {
                        stdout: JSON.stringify({
                            title: 'Fix bug',
                            state: 'open',
                            html_url: 'http://forgejo.test/testowner/testrepo/pulls/1',
                        }),
                    };
                }
                if (cmd.includes('/issues/1/comments')) {
                    return {
                        stdout: JSON.stringify([
                            {
                                user: { login: 'reviewer1' },
                                body: 'LGTM!',
                                created_at: '2024-01-01T00:00:00Z',
                            },
                        ]),
                    };
                }
                if (cmd.includes('/pulls/1/comments')) {
                    return {
                        stdout: JSON.stringify([
                            {
                                user: { login: 'reviewer2' },
                                body: 'Fix this line',
                                path: 'src/file.ts',
                                line: 10,
                            },
                        ]),
                    };
                }
                if (cmd.includes('/pulls/1/reviews')) {
                    return {
                        stdout: JSON.stringify([
                            {
                                user: { login: 'approver' },
                                state: 'approved',
                                body: 'Looks good',
                            },
                        ]),
                    };
                }
                return { stdout: '[]' };
            };

            const getPRComments = await import('../src/tools/forgejoGetPRComments.ts');
            const result = await getPRComments.default.execute('1', 'testowner/testrepo');

            expect(result.success).toBe(true);
            expect(result.content).toContain('Fix bug');
            expect(result.content).toContain('open');
            expect(result.content).toContain('LGTM!');
            expect(result.content).toContain('Fix this line');
            expect(result.content).toContain('approved');
        });

        it('handles PR with no comments', async () => {
            vi.resetModules();
            (globalThis as any).__mockExecHandler = (cmd: string) => {
                console.log('DEBUG mock called:', cmd.substring(0, 60));
                if (cmd.includes('git remote')) {
                    return {
                        stdout: 'origin\thttps://forgejo.test/testowner/testrepo.git (fetch)',
                    };
                }
                if (
                    cmd.includes('/pulls/2') &&
                    !cmd.includes('/issues') &&
                    !cmd.includes('/comments') &&
                    !cmd.includes('/reviews')
                ) {
                    return {
                        stdout: JSON.stringify({
                            title: 'Empty PR',
                            state: 'closed',
                            html_url: 'http://forgejo.test/testowner/testrepo/pulls/2',
                        }),
                    };
                }
                return { stdout: '[]' };
            };

            const getPRComments = await import('../src/tools/forgejoGetPRComments.ts');
            const result = await getPRComments.default.execute('2', 'testowner/testrepo');

            expect(result.success).toBe(true);
            expect(result.content).toContain('Empty PR');
            expect(result.content).toContain('No comments found');
        });
    });

    describe('forgejoPickTicket Happy Path', () => {
        beforeAll(() => {
            process.env.FORGEJO_URL = 'http://forgejo.test';
            process.env.FORGEJO_TOKEN = 'test-token';
        });

        it('picks a ticket and creates PR', async () => {
            vi.resetModules();
            (globalThis as any).__mockExecHandler = (cmd: string) => {
                if (cmd.includes('git fetch')) {
                    return { stdout: '' };
                }
                if (cmd.includes('git worktree list')) {
                    return { stdout: '' };
                }
                if (cmd.includes('git rev-parse')) {
                    return { error: 'fatal: not a valid ref', stdout: '' };
                }
                if (cmd.includes('git worktree add')) {
                    return {
                        stdout: 'Preparing working directory',
                        stderr: 'Preparing working directory',
                    };
                }
                if (cmd.includes('git push')) {
                    return { stdout: '' };
                }
                if (cmd.includes('/issues?state=open')) {
                    return {
                        stdout: JSON.stringify([
                            {
                                number: 42,
                                title: 'Fix the thing',
                                body: 'Description of the issue',
                                labels: [{ id: 1, name: 'to-do' }],
                                base: { branch: 'main' },
                            },
                        ]),
                    };
                }
                if (cmd.includes('/pulls?state=open')) {
                    return { stdout: JSON.stringify([]) };
                }
                if (cmd.includes('/pulls') && cmd.includes('POST')) {
                    return {
                        stdout: JSON.stringify({
                            number: 10,
                            title: 'Fix the thing',
                            html_url: 'http://forgejo.test/testowner/testrepo/pulls/10',
                        }),
                    };
                }
                return { stdout: JSON.stringify({}) };
            };

            const pickTicket = await import('../src/tools/forgejoPickTicket.ts');
            const result = await pickTicket.default.execute('testowner/testrepo');

            expect(result.success).toBe(true);
            expect(result.content).toContain('Ticket Picked');
            expect(result.content).toContain('Fix the thing');
            expect(result.content).toContain('issue-42');
            expect(result.content).toContain('Pull Request Created');
        });

        it('detects repo from git remote when no repo param', async () => {
            vi.resetModules();
            (globalThis as any).__mockExecHandler = (cmd: string) => {
                console.log('DEBUG mock called:', cmd.substring(0, 60));
                if (cmd.includes('git remote')) {
                    return { stdout: 'origin\thttps://forgejo.test/myowner/myrepo.git (fetch)' };
                }
                if (cmd.includes('git fetch')) {
                    return { stdout: '' };
                }
                if (cmd.includes('git worktree list')) {
                    return { stdout: '' };
                }
                if (cmd.includes('git rev-parse')) {
                    return { error: 'fatal:', stdout: '', stderr: 'fatal: ' };
                }
                if (cmd.includes('git worktree add')) {
                    return { stdout: 'Preparing', stderr: 'Preparing' };
                }
                if (cmd.includes('git push')) {
                    return { stdout: '' };
                }
                if (cmd.includes('/issues?state=open')) {
                    return {
                        stdout: JSON.stringify([
                            {
                                number: 7,
                                title: 'Auto-detected repo ticket',
                                body: 'Body',
                                labels: [],
                                base: { branch: 'main' },
                            },
                        ]),
                    };
                }
                if (cmd.includes('/pulls?state=open')) {
                    return { stdout: JSON.stringify([]) };
                }
                if (cmd.includes('/pulls') && cmd.includes('POST')) {
                    return {
                        stdout: JSON.stringify({
                            number: 20,
                            title: 'Auto-detected repo ticket',
                            html_url: 'http://forgejo.test/myowner/myrepo/pulls/20',
                        }),
                    };
                }
                return { stdout: JSON.stringify({}) };
            };

            const pickTicket = await import('../src/tools/forgejoPickTicket.ts');
            const result = await pickTicket.default.execute();

            expect(result.success).toBe(true);
            expect(result.content).toContain('myowner/myrepo');
            expect(result.content).toContain('issue-7');
        });
    });

    describe('forgejoCreatePR Happy Path', () => {
        beforeAll(() => {
            process.env.FORGEJO_URL = 'http://forgejo.test';
            process.env.FORGEJO_TOKEN = 'test-token';
        });

        it('creates a PR for a valid issue number', async () => {
            vi.resetModules();
            (globalThis as any).__mockExecHandler = (cmd: string) => {
                console.log('DEBUG mock called:', cmd.substring(0, 60));
                if (cmd.includes('git remote')) {
                    return {
                        stdout: 'origin\thttps://forgejo.test/testowner/testrepo.git (fetch)',
                    };
                }
                if (cmd.includes('git worktree add')) {
                    return {
                        stdout: 'Preparing working directory',
                        stderr: 'Preparing working directory',
                    };
                }
                if (cmd.includes('git push')) {
                    return { stdout: '' };
                }
                if (cmd.includes('/issues/5')) {
                    return {
                        stdout: JSON.stringify({
                            number: 5,
                            title: 'New feature',
                            body: 'Add a new feature',
                            labels: [{ id: 1, name: 'to-do' }],
                            base: { branch: 'main' },
                        }),
                    };
                }
                if (cmd.includes('/pulls') && cmd.includes('POST')) {
                    return {
                        stdout: JSON.stringify({
                            number: 15,
                            title: 'New feature',
                            html_url: 'http://forgejo.test/testowner/testrepo/pulls/15',
                        }),
                    };
                }
                return { stdout: JSON.stringify({}) };
            };

            const createPR = await import('../src/tools/forgejoCreatePR.ts');
            const result = await createPR.default.execute('5', 'testowner/testrepo');

            expect(result.success).toBe(true);
            expect(result.content).toContain('Pull Request Created');
            expect(result.content).toContain('New feature');
            expect(result.content).toContain('issue-5');
        });
    });
});
