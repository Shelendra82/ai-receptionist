import { processIncomingMessage } from './src/ai';
import './src/db';

async function test() {
  console.log('Sending message to AI...');
  try {
    const response = await processIncomingMessage('1234567890', '29 may is good at 10pm for my headache');
    console.log('AI Response:', response);
  } catch (e) {
    console.error('Script Error:', e);
  }
  process.exit(0);
}

test();
