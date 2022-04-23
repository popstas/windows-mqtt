const notifier = require('node-notifier');
const path = require('path');
const axios = require('axios');

module.exports = async (mqtt, config, log) => {

  async function notify(topic, message) {
    const msg = `${message}`;
    const data = {
      title: config.title,
      message: msg,
      icon: null,
      actions: [],
    }

    if (config.markAsReadText) data.actions = [config.markAsReadText];

    let notifyCallback = null;

    // parse message as json
    try {
      const obj = JSON.parse(msg);

      // console.log('obj: ', obj);

      // icon
      const appIcons = config.appIcons || {};
      if (appIcons[obj.app]) {
        data.icon = path.join(__dirname, '..', '..', 'assets', 'icons', appIcons[obj.app]);
      }

      // sound
      const appSounds = config.appSounds || {};
      if (appSounds[obj.app] !== undefined) {
        data.sound = appSounds[obj.app];
      }

      if (obj.msg) data.message = obj.msg;
      if (obj.title) data.title = obj.title;
      if (obj.actions) data.actions = [...data.actions, ...obj.actions.split(', ')];
      if (obj.answer_topic) { // TODO: answer_topic
        const answerTopic = obj.answer_topic;
        data.actions = [];
        data.tb = true;
      }

      notifyCallback = async (err, clickedButton) => {
        if (err) {
          console.log('err: ', err);
          return;
        }
    
        // console.log('clickedButton: ', clickedButton);
    
        if (clickedButton === 'activate') {} // клик по уведомлению
        if (clickedButton === 'dismissed') {} // закрытие уведомления
        if (clickedButton === 'timeout') {} // закрылось само

        // mark as readed in Android
        if (clickedButton === config.markAsReadText.toLowerCase()) {
          console.log('mark as read');
          await notifyClear(topic, obj.msg);
        }
      }
    } catch(e){}

    log(`< ${topic}: ${msg}`);
    console.log('data: ', data);
    notifier.notify(data, notifyCallback);
  }

  async function notifyClear(topic, message) {
    if (!config.clearNotificationWebhook) return;

    let msg = `${message}`;
    msg = msg.replace(/[\[\]*]/g, '?'); // [] вызывают 400 ошибку
    // msg = msg.substring(0, 64);

    try {
      await axios.get(config.clearNotificationWebhook, {
        params: { msg }
      });
    }

    catch (e) {
      console.log('error clearNotificationWebhook', e);
    }
  }

  return {
    subscriptions: [
      {
        topics: [ config.base + '/notify' ],
        handler: notify
      },
      {
        topics: [ config.base + '/clear' ],
        handler: notifyClear
      },
    ]
  }
}