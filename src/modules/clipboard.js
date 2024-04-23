const robot = require('robotjs');
const fs = require('fs');
const nutjs = require("@nut-tree/nut-js");
const { spawn } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');

module.exports = async (mqtt, config, log) => {

  let lastFoundImage = 'no';
  const clipboard = await import('clipboardy');

  // run python service, port 5000
  // const imageFindService = spawn('python', ['data/image-find-service.py']);

  let start = Date.now();
  const { screen, imageResource, Region, getActiveWindow } = nutjs;
  screen.config.highlightDurationMs = 1000;
  // screen.config.resourceDirectory = 'data/images/search';
  // console.log('screen: ', screen);

  // const scr = await screen.capture('screenshot.png', '.png', 'data');
  // fs.writeFileSync(config.screenshotPath, screen.image, 'binary');
  // const fileContents = fs.readFileSync('data/screenshot.png');
  // clipboard.default.writeSync(fileContents);
  // console.log('img: ', img);

  /* let found;
  for (const imagePath of config.searchImages) {
    found = await screen.find(imageResource(imagePath));
    if (found) continue;
  }
  console.log('found: ', found); */
  




  async function set(topic, message) {
    log(`< ${topic}: ${message}`);
    const clipboard = await import('clipboardy');
    clipboard.default.writeSync(`${message}`);
  }

  async function findButtonRequest(winReg) {
    return new Promise(async (resolv, reject) => {
      // const scr0 = await screen.captureRegion('screenshot.png', winReg, '.png', 'data');
      console.log('time: ', (Date.now()-start));
      // const scr = await screen.grabRegion(winReg);

      // const imageData = fs.readFileSync('data/screenshot.png');
      // const imageData = scr.image;

      const headers = {
        'Content-Type': 'multipart/form-data'
      };
      const formData = new FormData();
      // formData.append('image', imageData, { filename: 'screenshot.png', contentType: 'image/png' });
      formData.append('x', winReg.left);
      formData.append('y', winReg.top);
      formData.append('width', winReg.width);
      formData.append('height', winReg.height);
      if (lastFoundImage) {
        formData.append('image_last', lastFoundImage);
      }
      console.log('lastFoundImage: ', lastFoundImage);
      // formData.append('image', imageData);

      // console.log('formData: ', formData);
      try {
        const res = await axios.post(
          'http://127.0.0.1:5000/image/find', 
          formData,
          { headers: formData.getHeaders() }
        );
    
        console.log('find time: ', (Date.now()-start));
        resolv(res.data);
        // console.log('res: ', res);
      }
      catch (e) {
        console.log('e: ', e);
      }
    });
  }

  async function findButtonExec(winReg) {
    return new Promise((resolv, reject) => {
      const imgSearch = fs.readdirSync(config.imageSearchPath).map(f => `${config.imageSearchPath}/${f}`);

      /* const imgSearch = [
        'data/images/search/wse_button_square_blue.png',
        'data/images/search/wse_button_round.png',
        'data/images/search/wse_button_square_submit.png',
      ]; */

      const cmd = 'python';
      const args = [
        'data/find_coordinates.py',
        `${winReg.left},${winReg.top},${winReg.width},${winReg.height}`,
        imgSearch.join(','),
        '0.9',
      ];

      console.log('before exec time: ', (Date.now()-start));
      console.log('cmd: ', [cmd, ...args].join(' '));

      const prog = spawn(cmd, args);

      prog.stdin.end();
      prog.stdout.on('data', stdout => {
        console.log('exec data time: ', (Date.now()-start));
        const res = JSON.parse(stdout);
        console.log('res: ', res);
        resolv(res);
      });
      prog.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
      });
      prog.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
        console.log('exit time: ', (Date.now()-start));
      });
    });
  }

  async function wse (topic, message) {
    log(`< ${topic}: ${message}`);
    start = Date.now();
    try {
      const win = await getActiveWindow();
      const winReg = await win.region;
      console.log('time: ', (Date.now()-start));
      console.log('winReg: ', winReg);
  
      // const reg = new Region(x, y, width, height);
      // const scr = await screen.captureRegion('screenshot.png', winReg, '.png', 'data');
      // console.log('time: ', (Date.now()-start));
      // const scr2 = await screen.grabRegion(winReg);

      function clickFound(foundReg) {
        console.log('clickFound time: ', (Date.now()-start));
        // console.log('foundReg: ', foundReg);
        const absReg = new Region(
          foundReg.x + winReg.left + foundReg.width,
          foundReg.y + winReg.top + foundReg.height,
          8, // foundReg.width,
          8, // foundReg.height,
        );
        screen.highlight(absReg);

        const x = absReg.left + absReg.width;
        const y = absReg.top + absReg.height;
        const oldPos = robot.getMousePos();
        robot.moveMouse(x, y);
        robot.mouseClick('left');
        console.log('time: ', (Date.now()-start));
        robot.moveMouse(oldPos.x, oldPos.y);
      }

      // const res = await findButtonExec(winReg);
      const res = await findButtonRequest(winReg);
      console.log('res: ', res);
      if (res.found) clickFound(res);
      if (res.image) lastFoundImage = res.image;
    } catch (e) {
      log('wse failed');
      log(e);
      log(e.stack);
    }
 }

  async function screenshot(topic, message) {
    log(`< ${topic}: ${message}`);
    try {
      const data = JSON.parse(`${message}`);
      const { x, y, width, height } = data;
      /* const img = robot.screen.capture(x, y, width, height);

      const screenSize = robot.getScreenSize();
      console.log('screenSize: ', screenSize); // TODO: remove

      // const buffer = Buffer.from(img.image, 'base64');
      fs.writeFileSync(config.screenshotPath, img.image, 'binary');
      const fileContents = fs.readFileSync(config.screenshotPath); */

      const reg = new Region(x, y, width, height);
      const win = await getActiveWindow();
      const scr = await screen.captureRegion('screenshot.png', reg, '.png', 'data');

      
      // console.log('img: ', img);
      // const clipboard = await import('clipboardy');
      // clipboardy.writeSync(fileContents);
      // clipboard.default.writeSync(img.image);
    } catch (e) {
      log('screenshot require {"x": 0, "y": 0, "width": 100, "height": 100} as message');
      log(e);
    }
  }

  return {
    subscriptions: [
      {
        topics: [ config.base + '/set' ],
        handler: set
      },
      {
        topics: [ config.base + '/screenshot' ],
        handler: screenshot
      },
      {
        topics: [ config.base + '/wse' ],
        handler: wse
      },
    ],
  }
}
