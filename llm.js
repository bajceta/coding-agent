const { getDefaultModel } = require('./config');

class LLM {
  constructor() {
    this.modelConfig = getDefaultModel();
    this.abortController = null;
  }

  async streamResponse(messages, onChunk) {
    // Simple implementation without ESC key handling to avoid platform issues
    const response = await this.makeRequest(messages, onChunk);
    return response;
  }

  async makeRequest(messages, onChunk) {
    const controller = new AbortController();
    this.abortController = controller;
    
    const requestBody = {
      model: this.modelConfig.model,
      messages: messages,
      stream: true
    };

    const response = await fetch(`${this.modelConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.modelConfig.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6); // Remove 'data: ' prefix
            if (data.trim() === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content || '';
              if (content) {
                fullResponse += content;
                onChunk(content);
              }
            } catch (e) {
              // Handle non-JSON lines
              console.error('Error parsing chunk:', e.message);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return fullResponse;
  }
}

module.exports = LLM;
