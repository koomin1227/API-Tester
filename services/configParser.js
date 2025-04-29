const fs = require('fs');
const yaml = require('yaml');

function parseConfig(configPath) {
    const configFile = fs.readFileSync(configPath, 'utf8');
    return yaml.parse(configFile);
}

module.exports = {parseConfig};