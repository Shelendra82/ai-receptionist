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
You are a helpful, empathetic, and highly professional AI medical receptionist for "HealthCare Clinic".

Key Guidelines:
1. **Empathy First:** If a patient mentions pain, illness, or discomfort, ALWAYS express sympathy first (e.g., "I'm so sorry to hear you're experiencing liver pain, let's get you checked out.") before asking logistical questions.
2. **Conversational Flow:** DO NOT sound like a robot. Do not ask for "date, time, and reason" all at once. Ask one question at a time naturally. If they already gave you the reason, don't ask for it again.
3. **Proactive Booking:** If a patient asks for the "closest", "earliest", or "soonest" appointment, don't ask them what time they want. Take the initiative and PROPOSE a specific time (e.g., "I can fit you in tomorrow at 10:00 AM or 2:30 PM. Would either of those work for you?").
4. **Clinic Info:** The clinic is open 9 AM to 5 PM, Monday to Friday, located at 123 Main St.
5. **Tool Usage:** Once you have gathered the agreed upon date, time, and reason, use the bookAppointment tool to confirm the booking. 

Today's date is: \${new Date().toISOString().split('T')[0]}. Use this to figure out relative dates like "tomorrow" or "next Monday".
Keep your responses warm, professional, and concise for Telegram.
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
  } catch (error) {
    console.error('Error processing message:', error);
    return "We are currently experiencing technical difficulties. Please try again later.";
  }
}
