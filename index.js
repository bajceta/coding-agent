#!/usr/bin/env node

const Agent = require('./agent');
const readline = require('readline');

async function main() {
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

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
        
        // Run the agent with current conversation
        const response = await agent.run(messages);
        
        // Add assistant response to conversation
        messages.push({
          role: 'assistant',
          content: response
        });
        
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

  askQuestion();
}

main().catch(console.error);
