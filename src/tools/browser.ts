import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

interface ExecuteResult {
    success: boolean;
    content: string;
    error: string | null;
}

let mcpProcess: ChildProcess | null = null;
let requestId = 0;
let pendingRequests: Map<number, { resolve: (value: any) => void; reject: (error: any) => void }> =
    new Map();
let rl: readline.Interface | null = null;
let initialized = false;

function initMCP(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (initialized) {
            resolve();
            return;
        }

        mcpProcess = spawn('npx', ['@browsermcp/mcp@latest'], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        rl = readline.createInterface({
            input: mcpProcess.stdout!,
            crlfDelay: Infinity,
        });

        rl.on('line', (line) => {
            try {
                const response = JSON.parse(line);
                if (response.id !== undefined) {
                    const pending = pendingRequests.get(response.id);
                    if (pending) {
                        if (response.error) {
                            pending.reject(
                                new Error(response.error.message || JSON.stringify(response.error)),
                            );
                        } else {
                            pending.resolve(response.result);
                        }
                        pendingRequests.delete(response.id);
                    }
                }
            } catch (e) {
                console.error('Failed to parse MCP response:', line);
            }
        });

        mcpProcess.on('error', (err) => {
            reject(err);
        });

        mcpProcess.on('close', (code) => {
            initialized = false;
            mcpProcess = null;
        });

        setTimeout(async () => {
            initialized = true;
            try {
                const tools = await callMCP('tools/list', {});
                console.log('BrowserMCP available tools:', JSON.stringify(tools, null, 2));
            } catch (e) {
                console.log('Could not list tools:', e.message);
            }
            resolve();
        }, 2000);
    });
}

async function callMCP(method: string, params: Record<string, any> = {}): Promise<any> {
    if (!mcpProcess || !initialized) {
        await initMCP();
    }

    const id = ++requestId;
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
        pendingRequests.set(id, { resolve, reject });
        mcpProcess!.stdin!.write(JSON.stringify(request) + '\n');

        setTimeout(() => {
            if (pendingRequests.has(id)) {
                pendingRequests.delete(id);
                reject(new Error('MCP request timeout'));
            }
        }, 30000);
    });
}

async function browserExecute(
    action: string,
    params?: string | Record<string, any>,
): Promise<ExecuteResult> {
    try {
        await initMCP();

        let actionParams: Record<string, any> = {};
        if (params) {
            if (typeof params === 'string') {
                actionParams = JSON.parse(params);
            } else {
                actionParams = params;
            }
        }

        switch (action) {
            case 'list':
                const tools = await callMCP('tools/list', {});
                return { success: true, content: JSON.stringify(tools, null, 2), error: null };

            case 'navigate':
                await callMCP('browsermcp_browser_navigate', { url: actionParams.url });
                return { success: true, content: `Navigated to ${actionParams.url}`, error: null };

            case 'snapshot':
                const snapshot = await callMCP('browsermcp_browser_snapshot', {});
                return { success: true, content: JSON.stringify(snapshot, null, 2), error: null };

            case 'click':
                await callMCP('browsermcp_browser_click', {
                    element: actionParams.element,
                    ref: actionParams.ref,
                });
                return { success: true, content: `Clicked ${actionParams.element}`, error: null };

            case 'type':
                await callMCP('browsermcp_browser_type', {
                    element: actionParams.element,
                    ref: actionParams.ref,
                    text: actionParams.text,
                    submit: actionParams.submit || false,
                });
                return {
                    success: true,
                    content: `Typed "${actionParams.text}" into ${actionParams.element}`,
                    error: null,
                };

            case 'press_key':
                await callMCP('browsermcp_browser_press_key', { key: actionParams.key });
                return { success: true, content: `Pressed ${actionParams.key}`, error: null };

            case 'wait':
                await callMCP('browsermcp_browser_wait', { time: actionParams.seconds });
                return {
                    success: true,
                    content: `Waited ${actionParams.seconds} seconds`,
                    error: null,
                };

            case 'go_back':
                await callMCP('browsermcp_browser_go_back', {});
                return { success: true, content: 'Went back', error: null };

            case 'go_forward':
                await callMCP('browsermcp_browser_go_forward', {});
                return { success: true, content: 'Went forward', error: null };

            case 'get_console_logs':
                const logs = await callMCP('browsermcp_browser_get_console_logs', {});
                return { success: true, content: JSON.stringify(logs, null, 2), error: null };

            case 'screenshot':
                await callMCP('browsermcp_browser_screenshot', {});
                return { success: true, content: 'Screenshot taken', error: null };

            case 'hover':
                await callMCP('browsermcp_browser_hover', {
                    element: actionParams.element,
                    ref: actionParams.ref,
                });
                return { success: true, content: `Hovered ${actionParams.element}`, error: null };

            case 'select_option':
                await callMCP('browsermcp_browser_select_option', {
                    element: actionParams.element,
                    ref: actionParams.ref,
                    values: actionParams.values,
                });
                return {
                    success: true,
                    content: `Selected ${actionParams.values.join(', ')} in ${actionParams.element}`,
                    error: null,
                };

            default:
                return {
                    success: false,
                    content: '',
                    error: `Unknown action: ${action}`,
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
    description:
        'Control a local browser using BrowserMCP. Actions: navigate, snapshot, click, type, press_key, wait, go_back, go_forward, get_console_logs, screenshot, hover, select_option',
    arguments: [
        {
            action: 'action to perform (navigate, snapshot, click, type, press_key, wait, go_back, go_forward, get_console_logs, screenshot, hover, select_option)',
        },
        { params: 'JSON string of parameters for the action' },
    ],
    execute: browserExecute,
    enabled: true,
    safe: false,
};
