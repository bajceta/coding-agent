#!/usr/bin/env node

const Agent = require('./agent');
const readline = require('readline');

async function main() {

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');

    // Parse command line arguments for parser selection
    let parserType = 'plain'; // default parser
    const args = process.argv.slice(2);

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--parser' || args[i] === '-p') {
            if (i + 1 < args.length) {
                parserType = args[i + 1];
                i++; // Skip next argument as it's the value
            }
        }
    }

    const agent = new Agent(rl, parserType);

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

    // Initial system message
    const messages = [
        {
            role: 'system',
            content: `You are a helpful coding assistant. State only facts that you are sure of.
When asked to write code, provide complete, working examples with proper formatting.
Always explain your reasoning before providing code solutions.
If you encounter an error, analyze it carefully and suggest fixes.
`
        }
    ];

    async function askQuestion() {
        rl.question('> ', async (input) => {
            if (input.toLowerCase() === 'exit') {
                console.log('Goodbye!');
                rl.close();
                return;
            }

            // Add user message to conversation
            messages.push({
                role: 'user',
                content: input
            });

            try {
                console.log('\nAgent: ');

                await agent.run(messages);

                console.log('\n');
            } catch (error) {
                console.error('Error:', error.message);
                console.error('Error:', error.stack);
                messages.push({
                    role: 'assistant',
                    content: `Error: ${error.message}`
                });
            }

            askQuestion();
        });
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
    const question = process.argv[2];

    if (question && !question.startsWith('--parser') && !question.startsWith('-p')) {
        console.log(`> ${question}`);

        messages.push({
            role: 'user',
            content: question
        });

        try {
            console.log('\n🤖 Agent: ');
            await agent.run(messages);
            console.log('\n');
        } catch (error) {
            console.error('❌ Error:', error.message);
            console.error('Error:', error.stack);
        }

        rl.close();
        return;
    }

    askQuestion();
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

main().catch(error => {
    console.error('💥 Critical Error:', error.message);
    console.error('💥 Critical Error:', error.stack);
    process.exit(1);
});
