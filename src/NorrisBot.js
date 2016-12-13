import Botkit from 'botkit';
import {CronJob} from 'cron';

class NorrisBot {
  /**
   * Validates specified options then triggers internal methods to setup bot.
   *
   * @param {Object} options
   * @param {String} options.token
   * @param {Array} options.jokes
   */
  constructor(options) {
    if (!options.token) {
      throw new Error('NorrisBot: Missing token.');
    }

    if (Array.isArray(options.jokes) === false || options.jokes.length <= 0) {
      throw new Error('NorrisBot: Missing jokes.');
    }

    this.token = options.token;
    this.jokes = options.jokes;

    this.jokeOfTheDayCronJob = null;
    this.controller = null;
    this.botInstance = null;
    this.botIdentity = null;
    this.botUser = null;
    this.botGroups = null;
    this.botChannels = null;
    this.regexes = {
      salutations: ['\\bhi\\b', 'hiya', 'hey', 'hello', 'greetings'],
      gratitude: ['\\bthanks\\b', 'thank you'],
      jokeRequests: ['joke'],
      helpRequests: ['^help$']
    };

    this.createController();
    this.setupEventListeners();

    const rtmPromise = this.spawnBotAndStartRTM();

    rtmPromise.then(
      ({bot, payload}) => {
        this.botInstance = bot;
        this.botIdentity = this.botInstance.identifyBot();
        this.botUser = payload.users.find((user) => user.id === this.botIdentity.id);
      },
      (err) => {
        throw new Error(err);
      }
    );

    rtmPromise.then(({payload}) => {
      this.botGroups = this.getGroupsWithMember(payload.groups, this.botIdentity.id);
      this.botChannels = this.getChannelsWithMember(payload.channels);
      this.scheduleJokeOfTheDay();
    });
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
   * Spawn an instance of the bot and connects it to Real-time messaging API.
   *
   * @returns {Promise}
   */
  spawnBotAndStartRTM() {
    return new Promise((resolve, reject) => {
      this.controller.spawn({
        token: this.token
      }).startRTM((err, bot, payload) => {
        if (err) {
          reject(err);
        }

        resolve({bot, payload});
      });
    });
  }

  /**
   * Binds various event listners to respond to user interaction.
   */
  setupEventListeners() {
    // Salutation upon joining a channel.
    this.controller.on('bot_channel_join', (bot, message) => {
      bot.reply(message, 'Howdy folks.');
    });

    // Salutation upon joining a group.
    this.controller.on('bot_group_join', (bot, message) => {
      bot.reply(message, 'Howdy folks.');
    });

    // Salutation to someone speaking to the bot.
    this.controller.hears(
      this.regexes.salutations,
      ['direct_message', 'direct_mention', 'mention'],
      (bot, message) => {
        const userGreeting = (message.user) ? ` <@${message.user}>` : '';

        bot.reply(message, `Howdy${userGreeting}.`);
      }
    );

    // Telling a joke when being asked to.
    this.controller.hears(
      this.regexes.jokeRequests,
      ['direct_message', 'direct_mention', 'mention'],
      (bot, message) => {
        bot.startConversation(message, (err, convo) => {
          if (message.user) {
            convo.say(`Sure thing <@${message.user}>.`);
          }

          convo.say(this.getRandomJoke());
        });
      }
    );

    // Giving help when it's been requested.
    this.controller.hears(
      this.regexes.helpRequests,
      ['direct_message', 'direct_mention'],
      (bot, message) => {
        bot.reply(message, 'Ask me to tell you a joke, e.g.\n>"@norrisbot, tell me a joke please!"');
      }
    );

    // Responding to being thanked.
    this.controller.hears(
      this.regexes.gratitude,
      ['direct_message', 'direct_mention', 'mention'],
      (bot, message) => {
        const userGreeting = (message.user) ? ` <@${message.user}>` : '';

        bot.reply(message, `You're welcome${userGreeting}.`);
      }
    );
  }

  /**
   * Schedules "Joke of the Day" logic to run at 3pm every single day.
   */
  scheduleJokeOfTheDay() {
    this.jokeOfTheDayCronJob = new CronJob({
      cronTime: '0 0 15 * * *',
      onTick: this.postJokeOfTheDay,
      start: true,
      context: this
    });
  }

  /**
   * Cycles all groups and channels the bot is a part of, then posts a
   * randomly chosen "Joke of the Day".
   */
  postJokeOfTheDay() {
    const randomJoke = this.getRandomJoke();

    [].concat(this.botGroups, this.botChannels).forEach((obj) => {
      this.botInstance.api.chat.postMessage({
        'as_user': false,
        'channel': obj.id,
        'icon_url': this.botUser.profile.image_192,
        'text': `Joke of the day:\n>"${randomJoke}"`,
        'username':	'norrisbot'
      });
    });
  }

  /**
   * Looks inside of groups to filter down the list to only include groups
   * that aren't archived and that a specified member is a part of.
   *
   * @param {Array} groups
   * @param {String} memberID
   * @returns {Array}
   */
  getGroupsWithMember(groups, memberID) {
    return groups.filter((group) => {
      const isNotArchived = group.is_archived === false;
      const botBelongsToGroup = group.members.includes(memberID);

      return (isNotArchived && botBelongsToGroup);
    });
  }

  /**
   * Looks inside of channels to filter down the list to only include channels
   * that aren't archived and that a specified member is a part of.
   *
   * @param {Array} channels
   * @param {String} memberID
   * @returns {Array}
   */
  getChannelsWithMember(channels) {
    return channels.filter((channel) => {
      return (channel.is_archived === false && channel.is_member);
    });
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
