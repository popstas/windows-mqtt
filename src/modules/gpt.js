const globalConfig = require('../config.js');
const fs = require('fs');

module.exports = async (mqtt, config, log) => {

  // const ChatGPTAPI = require('chatgpt');
  // return;
  const { ChatGPTAPI } = await import('chatgpt');
  const api = new ChatGPTAPI({
    apiKey: config.openai_api_key,
    completionParams: config.completion_params,
    debug: config.debug,
  });

  const threads = {};

  function addToThread(msg, {systemMessage}) {
    const key = msg.chat?.id || 0;
    if (!threads[key]) {
      threads[key] = {
        lastAnswer: undefined,
        partialAnswer: '',
        systemMessage: systemMessage,
      };
    }
  }

  function gptRequest({ text, systemMessage, parentMessageId }) {
    const request = {
      timeoutMs: config.timeoutMs || 60000,
      systemMessage,
      parentMessageId,
    }
    return api.sendMessage(text, request);
  }

  // fix recognized speech text with gpt, copy to clipboard
  async function fixAndCopy(topic, message) {
    const inText = `${message}`;
    log(`< ${topic}: ${inText}`);

    let outText = '';
    try {
      const res = await gptRequest({
        text: inText,
        systemMessage: 'исправь ошибки в тексте',
      });
  
      if (config.debug) console.log('res:', res);
  
      outText = res?.text || 'бот не ответил';
    }
    catch(e) {
      outText = 'бот не ответил';
      console.error(e);
    }

    const notifyTopic = globalConfig.mqtt.base + '/notify/notify';
    mqtt.publish(notifyTopic, `Текст:\n${outText}`);

    const text = `${inText}\n\n${outText}`;

    const tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
    const d = new Date(Date.now() - tzoffset).
      toISOString().
      replace(/T/, ' ').      // replace T with a space
      replace(/\..+/, '')     // delete the dot and everything after
  
    fs.appendFileSync(config.logPath, `\n\n\n${d}\n${text}`)
    return mqtt.publish(`${globalConfig.mqtt.base}/clipboard/set`, text);
  }

  // ask to chatgpt, send result to /answer mqtt topic
  async function ask(topic, message) {
    log(`< ${topic}: ${message}`);
    const chatId = 1;

    const msg = {
      text: `${message}`,
      chat: {
        id: chatId,
      },
    };

    const systemMessage = threads[chatId]?.systemMessage || config.systemMessage;

    addToThread(msg, {systemMessage});

    try {
      threads[msg.chat.id].partialAnswer = '';
      const res = await gptRequest({
        text: msg.text,
        systemMessage,
        parentMessageId: threads[msg.chat.id].lastAnswer?.id
      });
      threads[msg.chat.id].partialAnswer = '';
      if (config.debug) console.log('res:', res);
      threads[msg.chat.id].lastAnswer = res;

      const text = res?.text || 'бот не ответил';
      return mqtt.publish(`${config.base}/answer`, text);
    } catch (e) {
      /*if (!ctx.secondTry && error.message.includes('maximum context')) {
        ctx.secondTry = true;
        forgetHistory(msg.chat.id);
        onMessage(ctx);
      }*/

      if (threads[msg.chat.id].partialAnswer !== '') {
        const answer = `бот ответил частично и забыл диалог:\n\nerror:\n\n${e.message}\n\n${threads[msg.chat.id].partialAnswer}`;
        threads[msg.chat.id].lastAnswer = undefined;
        threads[msg.chat.id].partialAnswer = '';
        return mqtt.publish(`${config.base}/answer`, answer);
      } else {
        return await mqtt.publish(`${config.base}/answer`, `error:\n\n${e.message}`);
      }
    }
  }

  // clear history
  async function clear(topic, message) {
    log(`< ${topic}: ${message}`);
    const chatId = 1;
    if (threads[chatId]) {
      threads[chatId].lastAnswer = undefined
    }
  }

  return {
    subscriptions: [
      {
        topics: [ config.base + '/ask' ],
        handler: ask
      },
      {
        topics: [ config.base + '/fix-and-copy' ],
        handler: fixAndCopy
      },
      {
        topics: [ config.base + '/clear' ],
        handler: clear
      },
    ]
  }
}