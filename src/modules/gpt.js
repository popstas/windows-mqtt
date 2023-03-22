
module.exports = async (mqtt, config, log) => {

  // const ChatGPTAPI = require('chatgpt');
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

    const request = {
      parentMessageId: threads[msg.chat.id].lastAnswer?.id,
      timeoutMs: config.timeoutMs || 60000,
      systemMessage,
    }

    try {
      threads[msg.chat.id].partialAnswer = '';
      const res = await api.sendMessage(msg.text, request);
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
        topics: [ config.base + '/clear' ],
        handler: clear
      },
    ]
  }
}