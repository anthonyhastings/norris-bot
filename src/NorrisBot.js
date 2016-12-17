import Botkit from 'botkit';
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
    if (typeof options.slackToken !== 'string' || options.slackToken.length <= 0) {
      throw new Error('NorrisBot: Missing Slack token.');
    }

    if (typeof options.giphyToken !== 'string' || options.giphyToken.length <= 0) {
      throw new Error('NorrisBot: Missing Giphy token.');
    }

    if (Array.isArray(options.jokes) === false || options.jokes.length <= 0) {
      throw new Error('NorrisBot: Missing jokes.');
    }

    this.slackToken = options.slackToken;
    this.giphyToken = options.giphyToken;
    this.jokes = options.jokes;

    this.jokeOfTheDay = null;
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
      jokeOfTheDayRequests: ['joke of the day'],
      randomJokeRequests: ['tell me a joke'],
      helpRequests: ['^help$']
    };

    this.setJokeOfTheDay();
    this.scheduleJokeOfTheDay();
    this.createController();
    this.setupEventListeners();
    this.spawnBotAndStartRTM().then(
      ({bot, payload}) => {
        this.botInstance = bot;
        this.botIdentity = this.botInstance.identifyBot();
        this.botUser = payload.users.find((user) => user.id === this.botIdentity.id);
        this.botGroups = this.getGroupsWithMember(payload.groups, this.botIdentity.id);
        this.botChannels = this.getChannelsWithMember(payload.channels);
      },
      (err) => {
        throw new Error(err);
      }
    );
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

    // Updates internal channel stack when bot joins a channel.
    this.controller.on('channel_joined', (bot, message) => {
      const {channel} = message;

      this.addChannel(channel);
    });

    // Updates internal channel stack when bot leaves a channel.
    this.controller.on('channel_left', (bot, message) => {
      const {channel: channelID} = message;

      this.removeChannel(channelID);
    });

    // Updates internal channel stack when bot joins a group.
    this.controller.on('group_joined', (bot, message) => {
      const {channel: group} = message;

      this.addGroup(group);
    });

    // Updates internal group stack when bot leaves a group.
    this.controller.on('group_left', (bot, message) => {
      const {channel: groupID} = message;

      this.removeGroup(groupID);
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
      this.regexes.randomJokeRequests,
      ['direct_message', 'direct_mention'],
      (bot, message) => {
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
        bot.startConversation(message, (err, convo) => {
          if (message.user) {
            convo.say(`Sure thing <@${message.user}>.`);
          }

          convo.say(`>${this.jokeOfTheDay}`);
        });
      }
    );

    // Giving help when it's been requested.
    this.controller.hears(
      this.regexes.helpRequests,
      ['direct_message', 'direct_mention'],
      (bot, message) => {
        bot.reply(message,
          'Ask me to tell you a joke, e.g.\n' +
          '>"@norrisbot, tell me a joke please!"\n\n' +
          'Ask me to tell you the joke of the day, e.g.\n' +
          '>"@norrisbot, tell me the joke of the day please!"'
        );
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
   * Updates the bots channel stack by adding the desired channel.
   *
   * @param {Object} channel
   */
  addChannel(channel) {
    const channelExists = Boolean(this.botChannels.find((botChannel) => {
      return botChannel.id === channel.id;
    }));

    if (!channelExists) {
      this.botChannels = this.botChannels.concat(channel);
    }
  }

  /**
   * Updates the bots channel stack by removing the one with the specified ID.
   *
   * @param {String} channelID
   */
  removeChannel(channelID) {
    const newChannels = this.botChannels.filter((channel) => {
      return channel.id !== channelID;
    });

    this.botChannels = newChannels;
  }

  /**
   * Updates the bots group stack by adding the desired group.
   *
   * @param {Object} group
   */
  addGroup(group) {
    const groupExists = Boolean(this.botGroups.find((botGroup) => {
      return botGroup.id === group.id;
    }));

    if (!groupExists) {
      this.botGroups = this.botGroups.concat(group);
    }
  }

  /**
   * Updates the bots group stack by removing the one with the specified ID.
   *
   * @param {String} groupID
   */
  removeGroup(groupID) {
    const newGroups = this.botGroups.filter((group) => {
      return group.id !== groupID;
    });

    this.botGroups = newGroups;
  }
}

export default NorrisBot;
