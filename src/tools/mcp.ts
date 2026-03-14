import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import type { ExecuteResult } from '../interfaces.ts';
import Log from '../log.ts';
import { getMCPServers } from '../config.ts';

const log = Log.get('mcp-client');

interface MCPClient {
    process: ChildProcess;
    requestId: number;
    pendingRequests: Map<number, { resolve: (value: any) => void; reject: (error: any) => void }>;
    rl: readline.Interface | null;
    initialized: boolean;
    ready: Promise<void>;
    tools: any[];
}

interface MCPServerConfig {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
}

const clients: Map<string, MCPClient> = new Map();

function createMCPClient(serverConfig: MCPServerConfig): MCPClient {
    const client: MCPClient = {
        process: null as any,
        requestId: 0,
        pendingRequests: new Map(),
        rl: null,
        initialized: false,
        ready: Promise.resolve(),
        tools: [],
    };

    const initPromise = new Promise<void>((resolve, reject) => {
        const args = serverConfig.args || [];
        const env = { ...process.env, ...serverConfig.env };

        log.info(`Starting MCP server: ${serverConfig.command} ${args.join(' ')}`);

        client.process = spawn(serverConfig.command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
        });

        client.rl = readline.createInterface({
            input: client.process.stdout!,
            crlfDelay: Infinity,
        });

        client.rl.on('line', (line) => {
            try {
                const response = JSON.parse(line);
                if (response.id !== undefined) {
                    const pending = client.pendingRequests.get(response.id);
                    if (pending) {
                        if (response.error) {
                            pending.reject(
                                new Error(response.error.message || JSON.stringify(response.error)),
                            );
                        } else {
                            pending.resolve(response.result);
                        }
                        client.pendingRequests.delete(response.id);
                    }
                }
            } catch (e) {
                log.debug('Failed to parse MCP response: ' + line + ' ' + e);
            }
        });

        client.process.on('error', (err) => {
            log.error(`MCP server error: ${err.message}`);
            reject(err);
        });

        client.process.on('close', (code) => {
            log.info(`MCP server closed with code ${code}`);
            client.initialized = false;
            clients.delete(serverConfig.name);
        });

        client.process.stderr?.on('data', (data) => {
            log.debug(`MCP stderr: ${data.toString()}`);
        });

        setTimeout(async () => {
            client.initialized = true;
            try {
                const tools = await callMCPInternal(client, 'tools/list', {});
                client.tools = tools?.tools || [];
                log.info(`MCP server ${serverConfig.name} ready with ${client.tools.length} tools`);
            } catch (e) {
                log.error(`Could not list tools: ${e}`);
            }
            resolve();
        }, 2000);
    });

    client.ready = initPromise;
    return client;
}

async function callMCPInternal(
    client: MCPClient,
    method: string,
    params: Record<string, any> = {},
): Promise<any> {
    if (!client.process || !client.initialized) {
        await client.ready;
    }

    const id = ++client.requestId;
    const request = {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
            name: method,
            arguments: params,
        },
    };

    return new Promise((resolve, reject) => {
        client.pendingRequests.set(id, { resolve, reject });
        client.process.stdin!.write(JSON.stringify(request) + '\n');

        setTimeout(() => {
            if (client.pendingRequests.has(id)) {
                client.pendingRequests.delete(id);
                reject(new Error('MCP request timeout'));
            }
        }, 30000);
    });
}

async function mcpExecute(action: string, params?: string): Promise<ExecuteResult> {
    try {
        let actionParams: Record<string, any> = {};
        if (params) {
            if (typeof params === 'string') {
                try {
                    actionParams = JSON.parse(params);
                } catch {
                    actionParams = { value: params };
                }
            } else {
                actionParams = params;
            }
        }

        switch (action) {
            case 'list_servers': {
                const serverList = Array.from(clients.keys());
                const serversInfo = serverList.map((name) => {
                    const client = clients.get(name);
                    return {
                        name,
                        initialized: client?.initialized || false,
                        tools: client?.tools?.map((t: any) => t.name) || [],
                    };
                });
                return {
                    success: true,
                    content: JSON.stringify(serversInfo, null, 2),
                    error: null,
                };
            }

            case 'start': {
                const serverName = actionParams.name;
                const command = actionParams.command;
                const args = actionParams.args || [];
                const env = actionParams.env || {};

                if (!serverName || !command) {
                    return {
                        success: false,
                        content: '',
                        error: 'Missing required parameters: name and command',
                    };
                }

                if (clients.has(serverName)) {
                    return {
                        success: true,
                        content: `MCP server '${serverName}' is already running`,
                        error: null,
                    };
                }

                const serverConfig: MCPServerConfig = {
                    name: serverName,
                    command,
                    args,
                    env,
                };

                const client = createMCPClient(serverConfig);
                clients.set(serverName, client);

                await client.ready;

                return {
                    success: true,
                    content: `MCP server '${serverName}' started successfully`,
                    error: null,
                };
            }

            case 'stop': {
                const serverName = actionParams.name;
                if (!serverName) {
                    return {
                        success: false,
                        content: '',
                        error: 'Missing required parameter: name',
                    };
                }

                const client = clients.get(serverName);
                if (!client) {
                    return {
                        success: false,
                        content: '',
                        error: `MCP server '${serverName}' is not running`,
                    };
                }

                client.process.kill();
                clients.delete(serverName);

                return {
                    success: true,
                    content: `MCP server '${serverName}' stopped`,
                    error: null,
                };
            }

            case 'list_tools': {
                const serverName = actionParams.name;
                if (!serverName) {
                    return {
                        success: false,
                        content: '',
                        error: 'Missing required parameter: name',
                    };
                }

                const client = clients.get(serverName);
                if (!client) {
                    return {
                        success: false,
                        content: '',
                        error: `MCP server '${serverName}' is not running`,
                    };
                }

                await client.ready;

                return {
                    success: true,
                    content: JSON.stringify(client.tools, null, 2),
                    error: null,
                };
            }

            case 'call': {
                const serverName = actionParams.server;
                const toolName = actionParams.tool;
                const toolArgs = actionParams.args || {};

                if (!serverName || !toolName) {
                    return {
                        success: false,
                        content: '',
                        error: 'Missing required parameters: server and tool',
                    };
                }

                const client = clients.get(serverName);
                if (!client) {
                    return {
                        success: false,
                        content: '',
                        error: `MCP server '${serverName}' is not running`,
                    };
                }

                await client.ready;

                const result = await callMCPInternal(client, toolName, toolArgs);

                return {
                    success: true,
                    content: JSON.stringify(result, null, 2),
                    error: null,
                };
            }

            case 'init': {
                const servers = actionParams.servers;
                if (!servers || !Array.isArray(servers)) {
                    return {
                        success: false,
                        content: '',
                        error: 'Missing required parameter: servers (array of server configs)',
                    };
                }

                const results: any[] = [];
                for (const serverConfig of servers) {
                    if (clients.has(serverConfig.name)) {
                        results.push({ name: serverConfig.name, status: 'already running' });
                        continue;
                    }

                    const client = createMCPClient(serverConfig);
                    clients.set(serverConfig.name, client);
                    results.push({ name: serverConfig.name, status: 'starting' });
                }

                await Promise.all(Array.from(clients.values()).map((c) => c.ready));

                return {
                    success: true,
                    content: JSON.stringify(results, null, 2),
                    error: null,
                };
            }

            default:
                return {
                    success: false,
                    content: '',
                    error: `Unknown action: ${action}. Valid actions: list_servers, start, stop, list_tools, call, init`,
                };
        }
    } catch (error) {
        return {
            success: false,
            content: '',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export default {
    description: `Manage MCP (Model Context Protocol) clients and call tools on them.
Actions:
- list_servers: List all running MCP servers and their tools
- start: Start an MCP server (requires name, command, args, env)
- stop: Stop a running MCP server (requires name)
- list_tools: List tools available on an MCP server (requires name)
- call: Call a tool on an MCP server (requires server, tool, args)
- init: Initialize multiple MCP servers at once (requires servers array)

Example params for start:
{"name": "filesystem", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]}

Example params for call:
{"server": "filesystem", "tool": "mcp_server_filesystem_read_directory", "args": {"path": "/tmp"}}

Example params for init:
{"servers": [{"name": "filesystem", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]}]}
`,
    arguments: [
        { action: 'Action to perform (list_servers, start, stop, list_tools, call, init)' },
        { params: 'JSON string of parameters for the action' },
    ],
    execute: mcpExecute,
    enabled: false,
    safe: false,
};

async function _autoInitMCPServers() {
    try {
        const servers = getMCPServers();
        if (servers && servers.length > 0) {
            log.info('Auto-initializing MCP servers from config...');
            for (const serverConfig of servers) {
                if (clients.has(serverConfig.name)) {
                    log.info(`MCP server '${serverConfig.name}' already running`);
                    continue;
                }
                const client = createMCPClient(serverConfig);
                clients.set(serverConfig.name, client);
            }
            await Promise.all(Array.from(clients.values()).map((c) => c.ready));
            log.info('MCP servers initialized');
        }
    } catch (error) {
        log.error('Failed to auto-init MCP servers: ' + (error as Error).message);
    }
}

//autoInitMCPServers();
