#!/usr/bin/env node

import { init as initConfig, getConfig } from './src/config.ts';
import type Agent from './src/agent.ts';
import fs from 'fs';
import path from 'path';

async function main() {
    initConfig();
    let intro = true;
    let isTTY = true;
    let interactive = false;
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.setEncoding('utf8');
    } else {
        isTTY = false;
    }

    let question: string | undefined = undefined;
    let helpFlag: boolean = false;
    const args: string[] = process.argv.slice(2);

    const config = getConfig();
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--parser' || args[i] === '-p') {
            if (i + 1 < args.length) {
                config.parserType = args[i + 1];
                i++; // Skip next argument as it's the value
            }
        } else if (args[i] === '--log-level' || args[i] === '-L') {
            if (i + 1 < args.length) {
                config.logLevel = args[i + 1];
                i++;
            }
        } else if (args[i] === '--yolo' || args[i] === '-y') {
            config.yoloMode = true;
        } else if (args[i] === '--disable-containers') {
            config.container = false;
        } else if (args[i] === '--enable-containers') {
            config.container = true;
        } else if (args[i] === '--no-intro') {
            intro = false;
        } else if (args[i] === '--help' || args[i] === '-h') {
            helpFlag = true;
            intro = false;
        } else if (args[i] === '--model' || args[i] === '-m') {
            if (i + 1 < args.length) {
                const modelName = args[i + 1];
                config.modelName = modelName;
                config.models[0].model = modelName;
                i++;
            }
        } else if (args[i] === '--log-file' || args[i] === '-l') {
            if (i + 1 < args.length) {
                config.logFile = args[i + 1];
                i++;
            }
        } else if (args[i] === '--interactive' || args[i] === '-it') {
            interactive = true;
        } else if (args[i] === '--rules' || args[i] === '-r') {
            if (i + 1 < args.length) {
                config.rulesFile = args[i + 1];
                i++;
            }
        } else if (args[i] === '--file' || args[i] === '-f') {
            if (i + 1 < args.length) {
                const filePath = args[i + 1];
                const resolvedPath = path.resolve(filePath);
                try {
                    if (!question) question = '';
                    question +=
                        'FilePath: ' +
                        filePath +
                        '\nFile start:\n' +
                        fs.readFileSync(resolvedPath, 'utf8') +
                        '\nFile end';
                    i++; // Skip next argument as it's the file path
                } catch (error) {
                    console.error(`Error reading file ${resolvedPath}:`, error.message);
                    process.exit(1);
                }
            } else {
                console.error('Error: --file flag requires a file path argument');
                process.exit(1);
            }
        } else if (question === undefined) {
            question = args[i]; // First non-parser argument is the question
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

    // Print help if --help flag is detected
    if (helpFlag) {
        printHelp();
        return;
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
        // Log the filename if provided
        console.log(`📝 Log file set to: ${config.logFile}`);
    }

    const agent: Agent = new (await import('./src/agent.ts')).default(config);

    await agent.init();

    // Handle command line arguments
    if (question) {
        await agent.askQuestion(question, interactive);
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

function printHelp() {
    console.log('Available Command Line Options:');
    console.log('- --parser <type>, -p <type>: Sets the parser type. (native, plain, json)');
    console.log('- --log-level <level>, -L <level>: Sets the log level.');
    console.log('- --yolo, -y: Enables YOLO mode (all tools allowed without confirmation).');
    console.log('- --disable-containers: Disables container mode.');
    console.log('- --enable-containers: Enables container mode.');
    console.log('- --no-intro: Disables the introductory message.');
    console.log(
        '- --help, -h: Prints this help information and disables the introductory message.',
    );
    console.log('- --log-file <file>, -l <file>: Sets the log file path.');
    console.log('- --model <name>, -m <name>: Sets the model name to use.');
    console.log(
        '- --interactive, -it: Enables interactive mode. The first argument after -it becomes the initial question.',
    );
    console.log(
        '- --file <file>, -f <file>: Reads content from a file and uses it as the question.',
    );
    console.log('');
    console.log('Examples:');
    console.log('- ./index.ts --parser plain --log-level debug');
    console.log('- ./index.ts --yolo --log-file output.log');
    console.log('- ./index.ts --help');
    console.log('- ./index.ts -it "What is the current date?"');
    console.log('- ./index.ts -f my_question.txt');
    console.log('');
    process.exit(0);
}
