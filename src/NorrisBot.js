import Botkit from 'botkit';
import BeepBoop from 'beepboop-botkit';
import giphy from 'giphy-api';
import {CronJob} from 'cron';

class NorrisBot {
  /**
   * Validates specified options then triggers internal methods to setup bot.
   *
   * @param {Object} options
   * @param {String} options.slackToken
   * @param {String} options.giphyToken
   * @param {Array} options.jokes
   */
  constructor(options) {
    if (typeof options.giphyToken !== 'string' || options.giphyToken.length <= 0) {
      throw new Error('NorrisBot: Missing Giphy token.');
    }

    if (Array.isArray(options.jokes) === false || options.jokes.length <= 0) {
      throw new Error('NorrisBot: Missing jokes.');
    }

    this.slackToken = options.slackToken;
    this.giphyToken = options.giphyToken;
    this.jokes = options.jokes;
    this.giphy = giphy(this.giphyToken);
    this.jokeOfTheDay = null;
    this.jokeOfTheDayCronJob = null;
    this.controller = null;
    this.beepboop = null;
    this.regexes = {
      salutations: ['\\bhi\\b', 'hiya', 'hey', 'hello', 'greetings'],
      gratitude: ['\\bthanks\\b', 'thank you'],
      jokeOfTheDayRequests: ['joke of the day'],
      randomJokeRequests: ['tell me a joke'],
      randomGifRequests: ['show me chuck'],
      helpRequests: ['^help$']
    };

    this.setJokeOfTheDay();
    this.scheduleJokeOfTheDay();
    this.createController();
    this.setupEventListeners();

    if (this.slackToken) {
      this.spawnBotAndStartRTM();
    } else {
      this.startBeepboopWithController();
    }
  }

  /**
   * Create Slack controller which can spawn the bot.
   */
  createController() {
    this.controller = Botkit.slackbot({
      retry: Infinity,
      debug: false
    });
  }

  /**
   * Binds various event listners to respond to user interaction.
   */
  setupEventListeners() {
    // Salutation upon joining a channel.
    this.controller.on('bot_channel_join', (bot, message) => {
      console.log('Event::bot_channel_join');
      bot.reply(message, 'Howdy folks.');
    });

    // Salutation upon joining a group.
    this.controller.on('bot_group_join', (bot, message) => {
      console.log('Event::bot_group_join');
      bot.reply(message, 'Howdy folks.');
    });

    // Salutation to someone speaking to the bot.
    this.controller.hears(
      this.regexes.salutations,
      ['direct_message', 'direct_mention', 'mention'],
      (bot, message) => {
        console.log('Event::salutation');
        const userGreeting = (message.user) ? ` <@${message.user}>` : '';

        bot.reply(message, `Howdy${userGreeting}.`);
      }
    );

    // Telling a joke when being asked to.
    this.controller.hears(
      this.regexes.randomJokeRequests,
      ['direct_message', 'direct_mention'],
      (bot, message) => {
        console.log('Event::randomJoke');

        bot.startConversation(message, (err, convo) => {
          if (message.user) {
            convo.say(`Sure thing <@${message.user}>.`);
          }

          convo.say(`>${this.getRandomJoke()}`);
        });
      }
    );

    // Telling the joke of the day when being asked to.
    this.controller.hears(
      this.regexes.jokeOfTheDayRequests,
      ['direct_message', 'direct_mention'],
      (bot, message) => {
        console.log('Event::jokeOfTheDay');

        bot.startConversation(message, (err, convo) => {
          if (message.user) {
            convo.say(`Sure thing <@${message.user}>.`);
          }

          convo.say(`>${this.jokeOfTheDay}`);
        });
      }
    );

    // Showing a random gif.
    this.controller.hears(
      this.regexes.randomGifRequests,
      ['direct_message', 'direct_mention'],
      (bot, message) => {
        console.log('Event::randomGif');

        bot.startConversation(message, (err, convo) => {
          if (message.user) {
            convo.say(`Sure thing <@${message.user}>.`);
          }

          this.giphy.random('chuck norris').then(
            (response) => {
              if (response.meta.status === 200) {
                convo.say(`${response.data.image_url}`);
              } else {
                convo.say('Uhoh... Something went wrong... Sorry!');
              }
            },
            (error) => {
              throw new Error(error);
            }
          );
        });
      }
    );

    // Giving help when it's been requested.
    this.controller.hears(
      this.regexes.helpRequests,
      ['direct_message', 'direct_mention'],
      (bot, message) => {
        console.log('Event::helpRequest');

        const botUsername = this.getBotUsername(bot);

        bot.reply(message,
          'Ask me to tell you a joke, e.g.\n' +
          `>"<@${botUsername}>, tell me a joke please!"\n\n` +
          'Ask me to tell you the joke of the day, e.g.\n' +
          `>"<@${botUsername}>, tell me the joke of the day please!"\n\n` +
          'Ask me to tell show you a gif, e.g.\n' +
          `>"<@${botUsername}>, show me chuck please!"`
        );
      }
    );

    // Responding to being thanked.
    this.controller.hears(
      this.regexes.gratitude,
      ['direct_message', 'direct_mention', 'mention'],
      (bot, message) => {
        console.log('Event::gratitude');

        const userGreeting = (message.user) ? ` <@${message.user}>` : '';

        bot.reply(message, `You're welcome${userGreeting}.`);
      }
    );
  }

  /**
   * Spawn an instance of the bot and connects it to Real-time messaging API.
   *
   * @returns {Promise}
   */
  spawnBotAndStartRTM() {
    return new Promise((resolve, reject) => {
      this.controller.spawn({
        token: this.slackToken
      }).startRTM((err, bot, payload) => {
        if (err) {
          reject(err);
        }

        resolve({bot, payload});
      });
    });
  }

  /**
   * Initialises BeepBoop wrapper around our controller to bring multi-team
   * capabilities to the bot.
   */
  startBeepboopWithController() {
    this.beepboop = BeepBoop.start(this.controller);
  }

  /**
   * Determines the bots username.
   *
   * @param {Object} bot - Instance of the bot.
   * @returns {String}
   */
  getBotUsername(bot) {
    return bot.identifyBot().name;
  }

  /**
   * Schedules "Joke of the Day" logic to run at 3pm every single day.
   */
  scheduleJokeOfTheDay() {
    this.jokeOfTheDayCronJob = new CronJob({
      cronTime: '0 0 15 * * *',
      onTick: this.setJokeOfTheDay,
      start: true,
      context: this
    });
  }

  /**
   * Sets the bots 'Joke of the Day' to a random joke.
   */
  setJokeOfTheDay() {
    this.jokeOfTheDay = this.getRandomJoke();
  }

  /**
   * Gets a random joke for the stack.
   *
   * @returns {String}
   */
  getRandomJoke() {
    const randomIndex = Math.floor(Math.random() * this.jokes.length);

    return this.jokes[randomIndex];
  }
}

export default NorrisBot;
