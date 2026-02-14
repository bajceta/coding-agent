#!/usr/bin/env node

import { Command } from 'commander';
import { init as initConfig, getConfig } from './src/config.ts';
import type Agent from './src/agent.ts';
import fs from 'fs';
import path from 'path';

const program = new Command();

program
    .name('codingagent')
    .description('A coding agent with dynamic tool discovery and OpenAI-compatible LLM support')
    .version('1.0.0')
    .option('-p, --parser <type>', 'Sets the parser type (native, plain, json)', 'native')
    .option('-L, --log-level <level>', 'Sets the log level', 'info')
    .option('-y, --yolo', 'Enables YOLO mode (all tools allowed without confirmation)', false)
    .option('--disable-containers', 'Disables container mode', false)
    .option('--enable-containers', 'Enables container mode', false)
    .option('--no-intro', 'Disables the introductory message', false)
    .option('-l, --log-file <file>', 'Sets the log file path')
    .option('-m, --model <name>', 'Sets the model name to use or list available models')
    .option('-it, --interactive', 'Enables interactive mode')
    .option('-f, --file <file>', 'Reads content from a file and uses it as the question')
    .option('-r, --rules <file>', 'Sets the rules file path')
    .argument('[question]', 'The question to ask the agent');

program.parse(process.argv);

const options = program.opts();
const args = program.args;

async function main() {
    initConfig();

    const config = getConfig();

    // Map commander options to config
    config.parserType = options.parser;
    config.logLevel = options.logLevel;
    config.yoloMode = options.yolo;
    config.container = options.enableContainers
        ? true
        : options.disableContainers
          ? false
          : config.container;
    config.logFile = options.logFile;
    config.rulesFile = options.rules;

    const intro = options.intro;
    const question = args[0];
    let fileinput: string | undefined = undefined;

    // Handle file input
    if (options.file) {
        const filePath = options.file;
        const resolvedPath = path.resolve(filePath);
        try {
            fileinput =
                'input file: ' +
                filePath +
                '\nFile start:\n' +
                fs.readFileSync(resolvedPath, 'utf8') +
                '\nFile end';
        } catch (error) {
            console.error(`Error reading file ${resolvedPath}:`, (error as Error).message);
            process.exit(1);
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

    if (config.yoloMode) {
        console.log('⚠️ YOLO mode enabled: All tools will be allowed without confirmation');
    }

    if (config.container) {
        console.log('⚠️ Container mode enabled');
    } else {
        console.log('⚠️ Container mode disabled');
    }

    if (config.logFile) {
        console.log(`📝 Log file set to: ${config.logFile}`);
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
    if (question || fileinput) {
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
