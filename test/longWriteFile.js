
tool_call: writeFile
path:index2.js
content:#!/usr/bin/env node

const Agent = require('./agent');
const readline = require('readline');

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Configure stdin for raw mode to capture ESC key
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');

  const agent = new Agent(rl);

  console.log('🚀 Coding Agent Started');
  console.log('💡 Press ESC twice to stop requests');
  console.log('🚪 Type "exit" or "quit" to quit\n');

  console.log('✨ Try asking the agent to use tools like:');
  console.log('   - "Read the contents of /etc/os-release"');
  console.log('   - "Create a new file called test.txt with content Hello World"');
  console.log('   - "Show me the current directory contents"');
  console.log('   - "List all files in the current directory"');
  console.log('   - "What is the current date?"');
  console.log('');

  // Initial system message
  const messages = [
    {
      role: 'system',
      content: `You are a helpful coding assistant. State only facts that you are sure of.
      You can use various tools to help with tasks, including file operations,
      system commands, and other utilities. Always provide clear, concise responses.
      `
    }
  ];

  async function askQuestion() {
    // Create a promise-based question to handle async/await properly
    const input = await new Promise((resolve) => {
      rl.question('> ', (input) => {
        resolve(input);
      });
    });

    // Handle exit commands
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log('👋 Goodbye!');
      rl.close();
      return;
    }

    // Add user message to conversation
    messages.push({
      role: 'user',
      content: input
    });

    try {
      console.log('\n🤖 Agent is thinking...');

      // Run the agent with current messages
      await agent.run(messages);

      console.log('\n');
    } catch (error) {
      console.error('❌ Error:', error.message);
      messages.push({
        role: 'assistant',
        content: `Error: ${error.message}`
      });
    }

    // Continue asking questions
    askQuestion();
  }

  // Handle ESC key presses directly for stopping requests
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
        console.log('\n⏳ Press ESC again to stop current request');
      }
    } else {
      escCount = 0; // Reset if any other key is pressed
    }
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log('\n\n👋 Goodbye!');
    rl.close();
    process.exit(0);
  });

  // Start the conversation
  askQuestion();
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error.message);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

main().catch(console.error);
end_tool_call
