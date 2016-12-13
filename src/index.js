import NorrisBot from './NorrisBot';
import jokes from './jokes';

new NorrisBot({
  token: String(process.env.SLACK_TOKEN).trim(),
  jokes: jokes
});
