import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { dbGet, dbAll, dbRun } from './db';
import { createAppointment, checkAvailability } from './calendar';
import { appendToSheet } from './sheets';

dotenv.config();

// Initialize the Google Gemini client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const SYSTEM_PROMPT = `
You are an elite, world-class medical AI receptionist for "HealthCare Clinic". You provide a 5-star patient experience.

**CRITICAL RULES FOR WORLD-CLASS CONVERSATION:**
1. **Empathy & Warmth First:** Never ask logistical questions immediately after a patient mentions pain or illness. Say something comforting first ("I am so sorry to hear about your liver pain, let's make sure you see a doctor right away.")
2. **NEVER Repeat Yourself:** Do not ask a question if the user has already answered it. Do not send multiple confirmations for the same thing.
3. **Be Proactive:** If the patient wants a "close" or "early" appointment, YOU MUST suggest two specific times (e.g., "I can fit you in tomorrow at 10:00 AM or 11:30 AM. Which works better?").
4. **Natural Flow:** Talk like a friendly human, not a form. Keep messages under 2-3 short sentences. 

**BOOKING RULES (STRICT):**
- Today's date is \${new Date().toISOString().split('T')[0]}.
- When calling the \`bookAppointment\` tool, the \`date\` parameter MUST be strictly in YYYY-MM-DD format (e.g. 2026-05-19).
- The \`time\` parameter MUST be strictly in 24-hour HH:MM format (e.g. 12:30 or 14:00).
- If the tool returns an ERROR, gracefully apologize to the user and say we will call them to manually confirm. Do NOT say "technical difficulties".
`;

const tools = [{
  functionDeclarations: [
    {
      name: 'bookAppointment',
      description: 'Book a medical appointment for a patient in the clinic calendar and save it to the records.',
      parameters: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING', description: 'Date of the appointment in YYYY-MM-DD format' },
          time: { type: 'STRING', description: 'Time of the appointment in HH:MM format (24-hour)' },
          reason: { type: 'STRING', description: 'Reason for the visit or symptoms' }
        },
        required: ['date', 'time', 'reason']
      }
    }
  ]
}];

export async function processIncomingMessage(patientIdentifier: string, messageBody: string): Promise<string> {
  try {
    // 1. Get or create patient (Using Telegram ID or unique identifier)
    let patient = await dbGet('SELECT * FROM patients WHERE phone_number = ?', [patientIdentifier]) as any;
    if (!patient) {
      await dbRun('INSERT INTO patients (phone_number) VALUES (?)', [patientIdentifier]);
      patient = await dbGet('SELECT * FROM patients WHERE phone_number = ?', [patientIdentifier]) as any;
    }

    console.log('1. Got patient');
    // 2. Save incoming message
    await dbRun('INSERT INTO messages (patient_id, role, content) VALUES (?, ?, ?)', [patient.id, 'user', messageBody]);
    console.log('2. Saved message');

    // 3. Fetch recent conversation history
    const historyRows = await dbAll('SELECT role, content FROM messages WHERE patient_id = ? ORDER BY created_at DESC LIMIT 10', [patient.id]) as any[];
    console.log('3. Fetched history');
    
    // Map database roles to Gemini roles
    const formattedHistory = historyRows.reverse().map((msg: any) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // In @google/genai, history can be passed in create() as `history: formattedHistory`, but we can also just pass it during initialization. Let's add it to create.
    const chatWithHistory = ai.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.7,
        tools: tools as any
      },
      history: formattedHistory
    });
    console.log('4. Created chat session');

    let aiMessage = '';

    // First, pass history if available
    console.log('5. Sending message to Gemini');
    const response = await chatWithHistory.sendMessage({ message: messageBody });
    console.log('6. Received response from Gemini');

    // Check if Gemini wants to call a tool
    if (response.functionCalls && response.functionCalls.length > 0) {
      const call = response.functionCalls[0];
      if (call.name === 'bookAppointment') {
        const args = call.args as any;
        const patientName = `Telegram User (${patientIdentifier})`;
        
        // 1. Book in Google Calendar
        const bookingResult = await createAppointment(
          patientName, 
          patientIdentifier,
          args.date,
          args.time,
          args.reason
        );

        // 2. Log to Google Sheets
        await appendToSheet(
          patientName,
          patientIdentifier,
          args.date,
          args.time,
          args.reason
        );

        // Send the result back to Gemini so it can answer the user
        const finalResponse = await chatWithHistory.sendMessage({
          message: [{
            functionResponse: {
              name: 'bookAppointment',
              response: { result: bookingResult + " Also successfully logged to Google Sheets." }
            }
          }] as any
        });
        
        aiMessage = finalResponse.text || "I've booked your appointment.";
      }
    } else {
      aiMessage = response.text || "I'm sorry, I'm having trouble processing that right now.";
    }

    // 5. Save outgoing message
    await dbRun('INSERT INTO messages (patient_id, role, content) VALUES (?, ?, ?)', [patient.id, 'assistant', aiMessage]);

    return aiMessage;
  } catch (error: any) {
    console.error('Error processing message:', error);
    return `Technical Error Details: \${error?.message || error}. Please send this to the developer.`;
  }
}
