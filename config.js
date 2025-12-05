const fs = require('fs');
const path = require('path');

function getConfig() {
  const configPath = path.join(process.env.HOME, '.config', 'codingagent.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      return config;
    }
  } catch (error) {
    console.error('Error reading config file:', error.message);
  }
  
  // Return default configuration if file doesn't exist or has errors
  return {
    models: [
      {
        name: "default",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4"
      }
    ]
  };
}

function getDefaultModel() {
  const config = getConfig();
  return config.models[0] || config.models.default || {
    name: "default",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4"
  };
}

module.exports = {
  getConfig,
  getDefaultModel
};
