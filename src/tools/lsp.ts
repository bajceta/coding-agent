import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import LSPManager from '../lspManager.ts';
import type { ExecuteResult } from '../interfaces.ts';
import Log from '../log.ts';
const log = Log.get();

interface LSPConfig {
    serverPath?: string;
    serverArgs?: string[];
    workspacePath?: string;
    retryCount?: number;
    timeout?: number;
}

// Support multiple workspaces with separate managers
let lspManagers: Map<string, LSPManager> = new Map();

function getWorkspaceKey(workspacePath?: string): string {
    return workspacePath || process.cwd();
}

function canPerformOperation(operation: string, capabilities: any): boolean {
    const operationMap = {
        hover: 'textDocument.hover',
        definition: 'textDocument.definition',
        references: 'textDocument.references',
        completion: 'textDocument.completion',
        signature: 'textDocument.signatureHelp',
    };

    const capabilityPath = operationMap[operation];
    if (!capabilityPath) return false;

    return hasProperty(capabilities, capabilityPath);
}

function hasProperty(obj: any, path: string): boolean {
    return path.split('.').reduce((current, key) => {
        return current && current[key] !== undefined;
    }, obj);
}

async function getLSPManager(workspacePath?: string): Promise<LSPManager> {
    const workspaceKey = getWorkspaceKey(workspacePath);

    let lspManager = lspManagers.get(workspaceKey);

    if (!lspManager) {
        // Check if typescript-language-server is available
        const checkResult = spawnSync('which', ['typescript-language-server'], {
            encoding: 'utf8',
        });
        if (checkResult.status !== 0) {
            throw new Error(
                'typescript-language-server not found. Please install it with: npm install -g typescript-language-server',
            );
        }
        lspManager = new LSPManager({
            workspacePath: workspaceKey,
            config: {
                retryCount: 3,
                timeout: 10000,
            },
        });

        try {
            await lspManager.connect();
            await lspManager.initialize(workspaceKey);
            lspManagers.set(workspaceKey, lspManager);
            log.debug('CREATED lsp manager for ' + workspaceKey);
        } catch (connectError) {
            throw new Error(`Failed to initialize LSP connection: ${connectError.message}`);
        }
    }

    return lspManager;
}

async function execute(
    operation: string,
    filePath?: string,
    ...args: string[]
): Promise<ExecuteResult> {
    log.debug('lsp operation ' + operation);
    try {
        if (!filePath) {
            return {
                success: false,
                content: null,
                error: 'File path required for this operation',
            };
        }

        // Ensure file exists
        if (!fs.existsSync(filePath)) {
            return {
                success: false,
                content: null,
                error: `File not found: ${filePath}`,
            };
        }

        const resolvedPath = path.resolve(filePath);
        //const resolvedPath = filePath;
        const workspacePath = path.dirname(resolvedPath);

        const lspManager = await getLSPManager(workspacePath);

        if (!lspManager.isConnected()) {
            return {
                success: false,
                content: null,
                error: 'LSP connection is not available',
            };
        }

        // Validate operation against server capabilities
        const capabilities = lspManager.getCapabilities();
        if (!canPerformOperation(operation, capabilities) && false) {
            return {
                success: false,
                content: null,
                error: `Server does not support ${operation} operation`,
            };
        }

        // Determine appropriate language server
        const languageServer = lspManager.getLanguageServer(resolvedPath);

        // Position parameters
        const line = parseInt(args[0]) || 0;
        const character = parseInt(args[1]) || 0;

        let result: any = null;

        switch (operation.toLowerCase()) {
            case 'hover':
                const hoverResponse = await lspManager.request('textDocument/hover', {
                    textDocument: { uri: `file://${resolvedPath}` },
                    position: { line, character },
                });
                result = hoverResponse.result;
                break;

            case 'definition':
                const definitionResponse = await lspManager.request('textDocument/definition', {
                    textDocument: { uri: `file://${resolvedPath}` },
                    position: { line, character },
                });
                result = definitionResponse.result;
                break;

            case 'references':
                const referencesResponse = await lspManager.request('textDocument/references', {
                    textDocument: { uri: `file://${resolvedPath}` },
                    position: { line, character },
                    context: { includeDeclaration: true },
                });
                result = referencesResponse.result;
                break;

            case 'completion':
                const completionResponse = await lspManager.request('textDocument/completion', {
                    textDocument: { uri: `file://${resolvedPath}` },
                    position: { line, character },
                });
                result = completionResponse.result;
                break;

            case 'signature':
                const signatureResponse = await lspManager.request('textDocument/signatureHelp', {
                    textDocument: { uri: `file://${resolvedPath}` },
                    position: { line, character },
                });
                result = signatureResponse.result;
                break;

            case 'diagnostics':
                const diagnostics = await lspManager.requestDiagnostics(`file://${resolvedPath}`);
                return {
                    success: true,
                    content: JSON.stringify(diagnostics),
                    error: null,
                };

            default:
                return {
                    success: false,
                    content: null,
                    error: `Unknown LSP operation: ${operation}`,
                };
        }

        if (result === null || result === undefined) {
            return {
                success: false,
                content: null,
                error: `No result for ${operation} operation`,
            };
        }

        return {
            success: true,
            content: JSON.stringify(result),
            error: null,
        };
    } catch (error) {
        return {
            success: false,
            content: null,
            error: error.message || 'LSP operation failed',
        };
    }
}

// Cleanup function for graceful shutdown
async function cleanup(): Promise<void> {
    const managers = [];
    for (const manager of lspManagers.values()) {
        managers.push(manager);
    }

    const cleanupPromises = managers.map(async (manager) => {
        try {
            await manager.shutdown();
        } catch (error) {
            console.error('Error shutting down LSP manager:', error);
        }
    });

    await Promise.all(cleanupPromises);
    lspManagers.clear();
}

// Export module
export default {
    name: 'lsp',
    description: 'Use Language Server Protocol for code analysis and assistance',
    arguments: [
        {
            operation:
                'operation to perform (hover, definition, references, completion, signature, diagnostics)',
        },
        {
            filePath: 'path to the file (required for most operations)',
        },
        {
            line: 'line number for position (optional, defaults to 0)',
        },
        {
            character: 'character position (optional, defaults to 0)',
        },
    ],
    execute,
    safe: true,
    enabled: true,
    cleanup,
};
