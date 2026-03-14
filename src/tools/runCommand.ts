import { spawn } from 'child_process';
import type { ExecuteResult, Message } from '../interfaces.ts';
import { getConfig } from '../config.ts';
import Log from '../log.ts';
import eventBus from '../eventBus.ts';
const log = Log.get('runCommand');

interface RunningProcess {
    process: any;
    timer: NodeJS.Timeout | null;
    outputBuffer: string;
    lastSendTime: number;
    processId: string;
    toolCallId: string;
    messages: Message[];
    startTime: number;
}

// Keep track of running processes
const runningProcesses: Record<string, RunningProcess> = {};

// Function to kill a running process
function killProcess(processId: string) {
    if (runningProcesses[processId]) {
        runningProcesses[processId].process.kill();
        if (runningProcesses[processId].timer) {
            clearTimeout(runningProcesses[processId].timer);
        }
        delete runningProcesses[processId];
        log.info(`Process ${processId} killed`);
    }
}

// Function to send output to LLM
function sendOutputToLLM(processId: string, includeContent: boolean = true) {
    const proc = runningProcesses[processId];
    if (!proc || !proc.outputBuffer) return;

    const output = proc.outputBuffer;
    proc.outputBuffer = '';
    proc.lastSendTime = Date.now();

    const updateMsg: Message = {
        role: 'tool',
        content: JSON.stringify({
            success: true,
            content: includeContent
                ? `Process ${processId} output:\n${output}`
                : `Process ${processId} running. Use readData('${processId}') to get the output so far.`,
            error: null,
        }),
        tool_call_id: proc.toolCallId,
    };

    proc.messages.push(updateMsg);
    log.info(`Sent output update for process ${processId}: ${output.substring(0, 100)}...`);

    eventBus.emit('render');
}

// Store for current execution context
let currentMessages: Message[] = [];
let currentToolCallId: string = '';

// Function to set execution context
export function setExecutionContext(messages: Message[], toolCallId: string) {
    currentMessages = messages;
    currentToolCallId = toolCallId;
}

// Function to start a process
async function startProcess(
    command: string,
    processId: string,
    options = {},
): Promise<ExecuteResult> {
    const cwd = process.cwd();

    // Generate a unique process ID if not provided
    if (!processId) {
        processId = `process_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Create process
    let spawnedProcess: any;

    const spawnOptions = { shell: '/bin/bash', encoding: 'utf8' as const, ...options };

    if (getConfig()?.container) {
        log.debug('Run in docker: ' + command);
        const dockerCommand = `docker run --rm -v ${cwd}:/workspace -w /workspace agent-runner:1 bash -c '${command}'`;
        spawnedProcess = spawn(dockerCommand, spawnOptions);
    } else {
        log.debug('Run in bash: ' + command);
        spawnedProcess = spawn(command, spawnOptions);
    }

    // Store process in running processes with execution context
    const processEntry: RunningProcess = {
        process: spawnedProcess,
        timer: null,
        outputBuffer: '',
        lastSendTime: Date.now(),
        processId,
        toolCallId: currentToolCallId,
        messages: currentMessages,
        startTime: Date.now(),
    };
    runningProcesses[processId] = processEntry;

    // Attach stdout/stderr listeners immediately to capture all output
    spawnedProcess.stdout.on('data', (data: string) => {
        processEntry.outputBuffer += data;
    });

    spawnedProcess.stderr.on('data', (data: string) => {
        processEntry.outputBuffer += data;
    });

    // Set up timer to send periodic updates every 1 second for long-running processes
    const timer = setInterval(() => {
        if (runningProcesses[processId]) {
            sendOutputToLLM(processId, false);
        }
    }, 1000);
    runningProcesses[processId].timer = timer;

    return new Promise((resolve) => {
        // Timer to handle long-running processes - send process ID after 1 second if not done
        const timeoutTimer = setTimeout(() => {
            if (runningProcesses[processId]) {
                const buf = runningProcesses[processId].outputBuffer;
                resolve({
                    success: true,
                    content: buf
                        ? `Process ${processId} still running. Output so far:\n${buf}\n\nUse readData('${processId}') to get more output.`
                        : `Process ID: ${processId}`,
                    error: null,
                });
            }
        }, 1000);

        // Listen for process exit - resolve immediately with output if completed
        spawnedProcess.on('exit', (code: number, signal: string) => {
            // Also wait for stdout/stderr to close to ensure we have all output
            spawnedProcess.stdout.removeAllListeners('data');
            spawnedProcess.stderr.removeAllListeners('data');

            clearTimeout(timeoutTimer);

            const buf = runningProcesses[processId]?.outputBuffer || '';
            delete runningProcesses[processId];

            resolve({
                success: true,
                content: buf,
                error: null,
            });
        });

        // Also listen for close event as fallback
        spawnedProcess.on('close', (code: number, signal: string) => {
            if (runningProcesses[processId]) {
                spawnedProcess.stdout.removeAllListeners('data');
                spawnedProcess.stderr.removeAllListeners('data');

                clearTimeout(timeoutTimer);

                const buf = runningProcesses[processId]?.outputBuffer || '';
                delete runningProcesses[processId];

                resolve({
                    success: true,
                    content: buf,
                    error: null,
                });
            }
        });
    });
}

// Function to read data from a running process
async function readData(processId: string): Promise<ExecuteResult> {
    const proc = runningProcesses[processId];

    if (!proc) {
        return {
            success: false,
            content: `Process ${processId} not found`,
            error: null,
        };
    }

    return {
        success: true,
        content: `Process ${processId} output:\n${proc.outputBuffer || ''}`,
        error: null,
    };
}

// Function to execute command
async function execute(command: string): Promise<ExecuteResult> {
    // Generate a unique process ID
    const processId = `process_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
        return await startProcess(command, processId);
    } catch (error) {
        console.log(error);
        process.exit(1);
        return {
            success: false,
            content: 'processID: ' + processId,
            error: error.message,
        };
    }
}

// Function to kill a process
async function killProcessById(processId: string): Promise<ExecuteResult> {
    killProcess(processId);
    return {
        success: true,
        content: `Process ${processId} killed`,
        error: null,
    };
}

// Export module
export default {
    description: `Run a bash command and stream output back to LLM.
    If command completes within 1 second, returns output immediately.
    If command runs longer than 1 second, returns process ID only.
    LLM can then use readData('processId') to get output so far.
    Replace shorter texts in files with 'sed -i' instead of writeFile tool.
    Find text in files using 'ag'.
    Always ignore node_modules and .git folders.
    Use killProcess('processId') to stop a running command.
    `,
    arguments: [{ command: 'bash command to execute' }],
    execute,
    enabled: true,
    safe: false,
    // Add a new tool for killing processes
    killProcess: killProcessById,
    // Add a tool for reading process data
    readData: readData,
};
