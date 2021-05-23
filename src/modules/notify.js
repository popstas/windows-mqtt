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
      if (obj.answer_topic) {
        const answerTopic = obj.answer_topic;
        data.actions = [];
        data.tb = true;
      }

      notifyCallback = async (err, clickedButton, something) => {
        if (err) {
          console.log('err: ', err);
          return;
        }
    
        console.log('clickedButton: ', clickedButton);
    
        if (clickedButton == 'activate') {} // клик по уведомлению
        if (clickedButton == 'dismissed') {} // закрытие уведомления
        if (clickedButton == 'timeout') {} // закрылось само

        // mark as readed in Android
        if (clickedButton == config.markAsReadText.toLowerCase()) {
          console.log('mark as read');
          try {
            const res = await axios.get(config.clearNotificationWebhook, {
              params: {
                msg: obj.msg.substring(0, 32)
              }
            });
          }

          catch (e) {
            console.log('error clearNotificationWebhook', e);
          }
        }
      }
    } catch(e){}

    log(`< ${topic}: ${msg}`);
    console.log('data: ', data);
    notifier.notify(data, notifyCallback);
  }

  return {
    subscriptions: [
      {
        topics: [ config.base + '/notify' ],
        handler: notify
      },
    ]
  }
}