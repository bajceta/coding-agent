#!/usr/bin/env node

import { Command } from 'commander';
import { init as initConfig, getConfig } from './src/config.ts';
import type Agent from './src/agent.ts';
import { initFileLogging } from './src/log.ts';
import { pickIssue } from './src/forgejoCli.ts';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const program = new Command();

program
    .name('codingagent')
    .description('A coding agent with dynamic tool discovery and OpenAI-compatible LLM support')
    .version('1.0.0')
    .option('-p, --parser <type>', 'Sets the parser type (native, plain, json)', 'native')
    .option('-L, --log-level <level>', 'Sets the log level', 'debug')
    .option('-y, --yolo', 'Enables RUN mode (all tools allowed without confirmation)', false)
    .option('--mode <mode>', 'Sets the execution mode (read, write, run)', 'read')
    .option('--disable-containers', 'Disables container mode', false)
    .option('--enable-containers', 'Enables container mode', false)
    .option('--no-intro', 'Disables the introductory message', false)
    .option('--no-stream', 'Disables streaming api', true)
    .option('--no-tools', 'Disables tools', true)
    .option('-l, --log-file <file>', 'Sets the log file path')
    .option('-m, --model <name>', 'Sets the model name to use or list available models', '1')
    .option('-it, --interactive', 'Enables interactive mode', false)
    .option('-f, --files [files...]', 'Reads content from a file and uses it as the question')
    .option('-r, --rules <file>', 'Sets the rules file path')
    .option('-q, --question <text>', 'Question')
    .option(
        '--fj [issue_number]',
        'Pick a Forgejo issue: search for open todo issues or use provided number, create worktree and PR',
    )
    .argument('[question]', 'The question to ask the agent');

program.parse(process.argv);

const options = program.opts();
console.log(options);
const args = program.args;

async function main() {
    initConfig();

    const config = getConfig();
    console.log(options);
    // Map commander options to config
    config.parserType = options.parser;
    config.logLevel = options.logLevel;
    // Map --yolo flag to run mode for backwards compatibility
    if (options.yolo) {
        config.executionMode = 'run';
    } else {
        config.executionMode = options.mode as any;
    }
    config.stream = options.stream;
    config.tools = options.tools;
    config.container = options.enableContainers
        ? true
        : options.disableContainers
          ? false
          : config.container;
    config.logFile = options.logFile || `/tmp/agent-log-${crypto.randomUUID()}`;
    config.rulesFile = options.rules;

    // Initialize file logging
    initFileLogging(config.logFile);

    const intro = options.intro;
    var question = args[0];
    if (options.question) {
        question = options.question;
    } else {
        question = args[0];
    }
    let fileinput: string | undefined = undefined;

    // Handle file input
    if (options.files) {
        for (var file of options.files) {
            const filePath = file;
            const resolvedPath = path.resolve(filePath);
            try {
                fileinput += '' + file + '= ' + fs.readFileSync(resolvedPath, 'utf8') + '\n';
            } catch (error) {
                console.error(`Error reading file ${resolvedPath}:`, (error as Error).message);
                process.exit(1);
            }
        }
    }

    // Handle model selection
    let modelNumber: number | null = null;
    if (options.model) {
        const modelArg = options.model;
        const modelNumberValue = parseInt(modelArg, 10);

        if (!isNaN(modelNumberValue) && modelNumberValue >= 1) {
            modelNumber = modelNumberValue;
        } else {
            config.modelName = modelArg;
            config.models[0].model = modelArg;
        }
    }

    if (intro) {
        console.log('Coding Agent Started');
        console.log('Press ESC twice to stop requests');
        console.log('Type "exit" to quit\n');
        console.log('Try asking the agent to use tools like:');
        console.log('- "Read the contents of /etc/os-release"');
        console.log('- "Create a new file called test.txt with content Hello World"');
        console.log('- "Show me the current directory contents"');
        console.log('');
    }

    if (config.executionMode === 'run') {
        console.log('⚠️ RUN mode enabled: All tools will be allowed without confirmation');
    }

    if (config.container) {
        console.log('⚠️ Container mode enabled');
    } else {
        console.log('⚠️ Container mode disabled');
    }

    if (config.logFile) {
        console.log(`📝 Log file set to: ${config.logFile}`);
    }

    // Handle --fj flag: pick a Forgejo issue, create worktree and PR
    let fjQuestion: string | undefined = undefined;
    if (options.fj !== undefined) {
        const issueNumber = options.fj ? parseInt(options.fj as string, 10) : undefined;
        try {
            console.log(
                `🔨 Picking Forgejo issue${issueNumber ? ` #${issueNumber}` : ' (searching for open todo)...'}`,
            );
            const result = await pickIssue(issueNumber);
            fjQuestion = result;
            console.log(result);
        } catch (error: any) {
            console.error(`💥 Failed to pick Forgejo issue: ${error.message}`);
            process.exit(1);
        }
    }

    const isTTY = process.stdin.isTTY;
    let interactive = options.interactive;

    if (isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.setEncoding('utf8');
    }

    // Create the agent
    const agent: Agent = new (await import('./src/agent.ts')).default(config);

    await agent.init();

    // Handle model selection by number if specified
    if (modelNumber !== null) {
        await agent.handleSelectModelByNumber(modelNumber);
    }

    // Handle command line arguments
    if (fjQuestion) {
        await agent.askQuestion(fjQuestion, interactive);
    } else if (question || fileinput) {
        if (!fileinput) fileinput = '';
        await agent.askQuestion(fileinput + '\n Prompt: ' + question, interactive);
    } else if (isTTY) {
        agent.showUserPrompt();
    } else {
        if (!question) {
            console.log('No question asked, exiting.\n');
            process.exit(0);
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Exiting gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Exiting gracefully...');
    process.exit(0);
});

main().catch((error) => {
    console.error('💥 Critical Error:', error.message);
    console.error('💥 Critical Error:', error.stack);
    process.exit(1);
});
