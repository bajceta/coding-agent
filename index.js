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

    const agent = new Agent(rl);

    console.log('Coding Agent Started');
    console.log('Press ESC twice to stop requests');
    console.log('Type "exit" to quit\n');
    console.log('Try asking the agent to use tools like:');
    console.log('- "Read the contents of /etc/os-release"');
    console.log('- "Create a new file called test.txt with content Hello World"');
    console.log('- "Show me the current directory contents"');
    console.log('');

    // Initial system message
    const messages = [
        {
            role: 'system',
            content: `You are a helpful coding assistant. State only facts that you are sure of.
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
                messages.push({
                    role: 'assistant',
                    content: `Error: ${error.message}`
                });
            }

            askQuestion();
        });
    }

    // Handle ESC key presses directly
    process.stdin.on('data', (key) => {
        // ESC key is ASCII 27
        if (key.charCodeAt(0) === 27) {
            console.log('\nStopping request...');
            agent.stopRequest(); // Call the agent's stop method
        }
    });



    const question = process.argv[2];

    if (question) {
        console.log(`> ${question}`);

        messages.push({
            role: 'user',
            content: question
        });

        try {
            console.log('\nAgent: ');
            await agent.run(messages);
            console.log('\n');
        } catch (error) {
            console.error('Error:', error.message);
        }

        rl.close();
        return;
    }

    askQuestion();
}

main().catch(console.error);
