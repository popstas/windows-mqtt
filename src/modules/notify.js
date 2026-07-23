const notifier = require('node-notifier');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

// Persistent toast via PowerShell (UWP Toast API) with scenario="reminder".
// node-notifier / SnoreToast can't emit scenario, so it always auto-dismisses.
function xmlEscape(s) {
  return `${s}`.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function notifyPersistent(data) {
  const title = xmlEscape(data.title || '');
  const message = xmlEscape(data.message || '');
  // WinRT needs a file:/// URI (not a raw Windows path) as the image src.
  // Note: toasts render png/jpg/gif reliably; .webp is not supported.
  const image = data.icon
    ? `<image placement="appLogoOverride" src="${xmlEscape(pathToFileURL(data.icon).href)}"/>`
    : '';
  // scenario="reminder" keeps the toast on screen until dismissed,
  // but Windows requires at least one <action>.
  const toastXml = `
<toast scenario="reminder">
  <visual>
    <binding template="ToastGeneric">
      ${image}
      <text>${title}</text>
      <text>${message}</text>
    </binding>
  </visual>
  <actions>
    <action content="OK" arguments="dismiss" activationType="foreground"/>
  </actions>
</toast>`.trim();

  // Use an installed AppID so the toast is allowed to show.
  const appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';
  const ps = `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml(@'
${toastXml}
'@)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${appId}').Show($toast)
`.trim();

  const child = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps],
    { windowsHide: true });
  child.on('error', (e) => console.log('notifyPersistent error', e));
}

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
      const wait = obj.wait ?? obj.persistent;
      if (wait !== undefined && wait !== false) data.wait = true;
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
    // console.log('data: ', data);
    if (data.wait) {
      // persistent toast (stays until dismissed) — node-notifier can't do this
      notifyPersistent(data);
    } else {
      notifier.notify(data, notifyCallback);
    }
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