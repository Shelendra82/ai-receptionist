import { dbAll } from './src/db';
import { processIncomingMessage } from './src/ai';

async function debug() {
  try {
    const messages = await dbAll('SELECT * FROM messages ORDER BY created_at DESC LIMIT 5') as any[];
    console.log('Latest messages:', messages);
    
    // Test the exact message that failed
    console.log('\nTesting the failed message...');
    const result = await processIncomingMessage('test_user', 'I have a stomach ache, please book an appointment for tommaro at 1PM');
    console.log('Result:', result);
  } catch (e) {
    console.error('Debug script error:', e);
  }
  process.exit(0);
}

debug();
