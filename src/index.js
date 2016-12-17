import NorrisBot from './NorrisBot';
import jokes from './jokes';

new NorrisBot({
  slackToken: String(process.env.SLACK_TOKEN || '').trim(),
  giphyToken: String(process.env.GIPHY_TOKEN || '').trim(),
  jokes: jokes
});
