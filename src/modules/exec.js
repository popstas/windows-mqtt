const exec = require('child_process').exec;

module.exports = async (mqtt, config, log) => {

  async function cmd(topic, message) {
    const cmd = `${message}`;
    log(`< ${topic}: ${cmd}`);
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return;
      }
      console.log(`stdout: ${stdout}`);
      console.error(`stderr: ${stderr}`);
    });
  }

  return {
    subscriptions: [
      {
        topics: [ config.base + '/cmd' ],
        handler: cmd
      },
    ]
  }
}