import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { EventEmitter } from 'events';
import * as path from 'path';
import Log from './log.ts';
const log = Log.get();

interface LSPMessage {
    jsonrpc: string;
    id?: number;
    method?: string;
    params?: any;
    result?: any;
    error?: any;
}

interface LSPConfig {
    serverPath?: string;
    serverArgs?: string[];
    workspacePath?: string;
    retryCount?: number;
    timeout?: number;
}

interface LSPManagerOptions {
    config?: LSPConfig;
}

class LSPManager extends EventEmitter {
    private process: any;
    private rl: any;
    private messageId = 0;
    private pendingRequests: Map<
        number,
        { resolve: (response: LSPMessage) => void; reject: (error: Error) => void }
    > = new Map();
    private initialized = false;
    private config: LSPConfig;
    private maxRetries: number;
    private retryDelay: number;
    private lastError: Error | null = null;
    private serverCapabilities: any = {};
    private languageServers: Map<string, string> = new Map();
    private diagnostics: Map<string, any[]> = new Map();
    private currentWorkspace: string = '';

    constructor(options: LSPManagerOptions = {}) {
        super();

        this.config = {
            //serverPath: 'vtsls',
            serverPath: 'typescript-language-server',
            serverArgs: ['--stdio', '--log-level', '4'],
            workspacePath: process.cwd(),
            retryCount: 3,
            timeout: 1000,
            ...options.config,
        };

        this.maxRetries = this.config.retryCount || 3;
        this.retryDelay = 1000;
        this.currentWorkspace = this.config.workspacePath || process.cwd();

        // Map file extensions to language servers
        this.languageServers.set('.ts', 'typescript-language-server');
        this.languageServers.set('.js', 'typescript-language-server');
        this.languageServers.set('.py', 'python-lsp');
        this.languageServers.set('.go', 'gopls');
        this.languageServers.set('.rs', 'rust-analyzer');

        this.setMaxListeners(20);
    }

    async connect(retryCount = 0): Promise<void> {
        try {
            // Start language server
            const languageServer = this.getCurrentLanguageServer();

            log.debug(`spawn ${languageServer}`);
            this.process = spawn(languageServer, this.config.serverArgs || ['--stdio'], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            this.process.stdin.setEncoding('utf8');
            this.process.stdout.setEncoding('utf8');

            this.process.stdout.on('data', (data) => {
                log.debug('lsp stdout:' + data);
                const lines = data.split('\n');
                lines.forEach((line) => {
                    log.debug('process line: ' + line);
                    try {
                        const message: LSPMessage = JSON.parse(line);
                        if (message.id !== undefined && this.pendingRequests.has(message.id)) {
                            const { resolve, reject } = this.pendingRequests.get(message.id)!;
                            this.pendingRequests.delete(message.id);
                            resolve(message);
                        } else if (message.method) {
                            this.emit('notification', message);
                        } else if (message.result || message.error) {
                            this.emit('response', message);
                        }
                    } catch (e) {
                        // Silently ignore parsing errors for LSP messages
                    }
                });
            });

            this.process.stderr.on('data', (data) => {
                log.error('lsp stderr:' + data);
            });

            // Handle process errors
            this.process.stderr.on('data', (data) => {
                log.error('LSP stderr:', data.toString());
            });

            this.process.on('error', (error) => {
                this.lastError = error;
                log.error('LSP process error:', error);
            });

            this.process.on('close', (code: number, signal: string) => {
                log.info(`LSP process closed with code ${code} and signal ${signal}`);
                this.initialized = false;
                this.process = null;
            });

            log.debug('Wait for lsp init');
            // Wait for server to be ready
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    log.error('LSP timeout');
                    //reject(new Error('LSP initialization timeout'));
                    resolve();
                }, 300);

                const handler = (message: LSPMessage) => {
                    if (message.method === 'window/logMessage') {
                        // Server is ready when it starts logging
                        this.removeListener('notification', handler);
                        clearTimeout(timeout);
                        resolve();
                    }
                };
                this.on('notification', handler);
            });

            this.lastError = null;
        } catch (error) {
            this.lastError = error as Error;
            if (retryCount < this.maxRetries) {
                log.error(
                    `LSP connection failed, retrying in ${this.retryDelay}ms... (${retryCount + 1}/${this.maxRetries})`,
                );
                await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
                return this.connect(retryCount + 1);
            }
            throw error;
        }
    }

    async initialize(workspacePath: string): Promise<void> {
        this.currentWorkspace = workspacePath;

        const response = await this.request('initialize', {
            processId: process.pid,
            workspaceFolders: [
                {
                    uri: `file://${path.resolve(workspacePath)}`,
                    name: 'project',
                },
            ],
            capabilities: {
                textDocument: {
                    hover: {},
                    definition: {},
                    references: {},
                    completion: {},
                    signatureHelp: {},
                },
            },
        });

        if (response.result) {
            //            log.debug(JSON.stringify(response));
            //           log.debug(JSON.stringify(response.result));
            //          log.debug(JSON.stringify(response.result.capabilities));
            this.serverCapabilities = response.result.capabilities || {};
            this.initialized = true;
            this.emit('initialized');
            log.info('LSP initialized');

            // Send initialized notification
            await this.sendNotification('initialized', undefined);
        }
    }

    async request(method: string, params?: any): Promise<LSPMessage> {
        log.info(method);
        const wait = this.config.timeout || 3000;
        return new Promise((resolve, reject) => {
            const id = ++this.messageId;
            const message: LSPMessage = {
                jsonrpc: '2.0',
                id,
                method,
                params,
            };

            this.pendingRequests.set(id, { resolve, reject });
            const content = JSON.stringify(message);

            if (this.process && this.process.stdin.writable) {
                this.process.stdin.write('Content-Length: ' + content.length + '\r\n\r\n');
                this.process.stdin.write(content);
                log.debug('LSP request: ' + method + ' wait for: ' + wait);
                log.debug('Content-Length: ' + content.length + '\r\n\r\n');
                log.debug(content);
            } else {
                reject(new Error('LSP process not available'));
            }

            // Timeout after configured time

            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request ${method} timed out`));
                }
            }, wait);
        });
    }

    async sendNotification(method: string, params?: any): Promise<void> {
        const message: LSPMessage = {
            jsonrpc: '2.0',
            method,
            params,
        };

        if (this.process && this.process.stdin.writable) {
            this.process.stdin.write(JSON.stringify(message) + '\n');
        }
    }

    async shutdown(): Promise<void> {
        if (this.initialized) {
            //    await this.request('shutdown', undefined);
        }
        await this.sendNotification('exit', undefined);

        // Clean up
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.initialized = false;
    }

    isConnected(): boolean {
        return !!this.process && !this.process.killed;
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    getLastError(): Error | null {
        return this.lastError;
    }

    getCapabilities(): any {
        return this.serverCapabilities;
    }

    getLanguageServer(filePath: string): string {
        const ext = path.extname(filePath);
        return this.languageServers.get(ext) || 'typescript-language-server';
    }

    getCurrentLanguageServer(): string {
        return this.config.serverPath || 'typescript-language-server';
    }

    async requestDiagnostics(uri: string): Promise<any[]> {
        try {
            const response = await this.request('textDocument/diagnostic', {
                textDocument: { uri },
            });

            if (response.result) {
                this.diagnostics.set(uri, response.result.items || []);
                return response.result.items || [];
            }
        } catch (error) {
            console.error('Failed to request diagnostics:', error);
        }
        return [];
    }

    getDiagnostics(uri: string): any[] {
        return this.diagnostics.get(uri) || [];
    }
}

export default LSPManager;
