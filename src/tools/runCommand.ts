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
function sendOutputToLLM(processId: string) {
    const proc = runningProcesses[processId];
    if (!proc || !proc.outputBuffer) return;

    const output = proc.outputBuffer;
    proc.outputBuffer = '';
    proc.lastSendTime = Date.now();

    const updateMsg: Message = {
        role: 'tool',
        content: JSON.stringify({
            success: true,
            content: `Process ${processId} output:\n${output}`,
            error: null,
        }),
        tool_call_id: proc.toolCallId,
    };

    proc.messages.push(updateMsg);
    log.info(`Sent output update for process ${processId}: ${output.substring(0, 100)}...`);

    eventBus.emit('render');
}

// Function to handle process output
function handleProcessOutput(processId: string, spawnedProcess: any) {
    const proc = runningProcesses[processId];
    if (!proc) return;

    proc.outputBuffer = '';
    proc.lastSendTime = Date.now();

    // Handle stdout
    spawnedProcess.stdout.on('data', (data: string) => {
        proc.outputBuffer += data;
        // Check if we need to send output to LLM
        if (Date.now() - proc.lastSendTime >= 5000) {
            sendOutputToLLM(processId);
        }
    });

    // Handle stderr
    spawnedProcess.stderr.on('data', (data: string) => {
        proc.outputBuffer += data;
        // Check if we need to send output to LLM
        if (Date.now() - proc.lastSendTime >= 5000) {
            sendOutputToLLM(processId);
        }
    });

    // Handle process exit
    spawnedProcess.on('exit', (code: number, signal: string) => {
        // Send any remaining output
        if (proc.outputBuffer) {
            sendOutputToLLM(processId);
        }

        // Clean up
        if (proc.timer) {
            clearTimeout(proc.timer);
        }
        delete runningProcesses[processId];
        log.info(`Process ${processId} exited with code ${code} and signal ${signal}`);
    });

    // Handle process error
    spawnedProcess.on('error', (error: Error) => {
        // Send any remaining output
        if (proc.outputBuffer) {
            sendOutputToLLM(processId);
        }

        // Clean up
        if (proc.timer) {
            clearTimeout(proc.timer);
        }
        delete runningProcesses[processId];
        log.error(`Process ${processId} error: ${error.message}`);
    });
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

    if (getConfig()?.container) {
        log.debug('Run in docker: ' + command);
        const dockerCommand = `docker run --rm -v ${cwd}:/workspace -w /workspace agent-runner:1 bash -c '${command}'`;
        spawnedProcess = spawn(dockerCommand, { shell: '/bin/bash', ...options });
    } else {
        log.debug('Run in bash: ' + command);
        spawnedProcess = spawn(command, { shell: '/bin/bash', ...options });
    }

    // Store process in running processes with execution context
    runningProcesses[processId] = {
        process: spawnedProcess,
        timer: null,
        outputBuffer: '',
        lastSendTime: Date.now(),
        processId,
        toolCallId: currentToolCallId,
        messages: currentMessages,
    };

    // Handle output
    handleProcessOutput(processId, spawnedProcess);

    // Send initial output
    sendOutputToLLM(processId);

    // Set up timer to send output every 5 seconds
    const timer = setInterval(() => {
        if (runningProcesses[processId]) {
            sendOutputToLLM(processId);
        }
    }, 5000);

    // Store the timer
    runningProcesses[processId].timer = timer;

    // Return initial result
    return {
        success: true,
        content: `Command started: ${command}. Process ID: ${processId}. Output will be sent every 5 seconds. Use killProcess('${processId}') to stop it.`,
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
    description: `Run a bash command and stream output back to LLM every 5 seconds.
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
};
