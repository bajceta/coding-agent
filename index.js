#!/usr/bin/env node

const Agent = require('./agent');
const readline = require('readline');

async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');

    // Parse command line arguments for parser selection and yolo mode
    let parserType = 'plain'; // default parser
    let question = '';
    let yoloMode = false; // default is false
    const args = process.argv.slice(2);

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--parser' || args[i] === '-p') {
            if (i + 1 < args.length) {
                parserType = args[i + 1];
                i++; // Skip next argument as it's the value
            }
        } else if (args[i] === '--yolo' || args[i] === '-y') {
            yoloMode = true;
        } else if (!question) {
            question = args[i]; // First non-parser argument is the question
        }
    }

    const agent = new Agent(rl, parserType);
    agent.yoloMode = yoloMode; // Set yolo mode

    console.log('Coding Agent Started');
    console.log('Press ESC twice to stop requests');
    console.log('Type "exit" to quit\n');
    console.log('Try asking the agent to use tools like:');
    console.log('- "Read the contents of /etc/os-release"');
    console.log('- "Create a new file called test.txt with content Hello World"');
    console.log('- "Show me the current directory contents"');
    console.log('');

    if (parserType === 'json') {
        console.log('Using JSON parser mode');
    } else {
        console.log('Using plain text parser mode');
    }
    console.log('');

    if (yoloMode) {
        console.log('⚠️ YOLO mode enabled: All tools will be allowed without confirmation');
    }

    /**
     * Handle ESC key presses for stopping requests
     */
    let escCount = 0;
    process.stdin.on('data', (key) => {
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
        console.log(`> ${question}`);

        try {
            console.log('\n🤖 Agent: ');
            await agent.askQuestion(question);
            console.log('\n');
        } catch (error) {
            console.error('❌ Error:', error.message);
            console.error('Error:', error.stack);
        }

        rl.close();
        return;
    }

    agent.showUserPrompt();
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