#!/usr/bin/env node

import Agent from './agent.ts';
import { init as initConfig, getConfig } from './config.ts'; // Import config singleton

async function main() {
    initConfig();
    let intro = true;
    let isTTY = true;
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.setEncoding('utf8');
    } else {
        isTTY = false;
    }

    // Parse command line arguments for parser selection and yolo mode
    let _parserType: string = 'plain'; // default parser
    let question: string | undefined = undefined;
    let _yoloMode: boolean = false; // default is false
    let _containerMode: boolean = true; // default is true as requested
    const args: string[] = process.argv.slice(2);

    // Get config after potential updates
    const config = getConfig();

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--parser' || args[i] === '-p') {
            if (i + 1 < args.length) {
                config.parserType = args[i + 1];
                i++; // Skip next argument as it's the value
            }
        } else if (args[i] === '--yolo' || args[i] === '-y') {
            config.yoloMode = true;
        } else if (args[i] === '--disable-containers') {
            config.container = false;
        } else if (args[i] === '--no-intro') {
            intro = false;
        } else if (args[i] === '--enable-containers') {
            config.container = true;
        } else if (question === undefined) {
            question = args[i]; // First non-parser argument is the question
        }
    }

    const agent: Agent = new Agent(config);

    await agent.init();
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

    if (config.parserType === 'json') {
        console.log('Using JSON parser mode');
    } else {
        console.log('Using plain text parser mode');
    }

    if (config.yoloMode) {
        console.log('⚠️ YOLO mode enabled: All tools will be allowed without confirmation');
    }

    if (config.container) {
        console.log('⚠️ Container mode enabled');
    } else {
        console.log('⚠️ Container mode disabled');
    }

    /**
     * Handle ESC key presses for stopping requests
     */
    let escCount: number = 0;
    process.stdin.on('data', (key: string) => {
        // ESC key is ASCII 27
        if (key.charCodeAt(0) === 27) {
            escCount++;
            if (escCount >= 2) {
                console.log('\n🛑 Stopping request...');
                agent.stopRequest(); // Call the agent's stop method
                escCount = 0; // Reset counter
            } else {
                console.log('\n⚠️ Press ESC again to stop current request');
            }
        } else {
            escCount = 0; // Reset if any other key is pressed
        }
    });

    // Handle command line arguments
    if (question) {
        await agent.askQuestion(question);
        return;
    }

    if (isTTY) {
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
