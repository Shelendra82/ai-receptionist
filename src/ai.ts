import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';
import { dbGet, dbAll, dbRun } from './db';
import { createAppointment } from './calendar';
import { appendToSheet } from './sheets';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `
You are an elite, world-class medical AI receptionist for "HealthCare Clinic". You provide a 5-star patient experience.

**CRITICAL RULES FOR WORLD-CLASS CONVERSATION:**
1. **Empathy & Warmth First:** Never ask logistical questions immediately after a patient mentions pain or illness. Say something comforting first ("I am so sorry to hear about your liver pain, let's make sure you see a doctor right away.")
2. **NEVER Repeat Yourself:** Do not ask a question if the user has already answered it. Do not send multiple confirmations for the same thing.
3. **Be Proactive:** If the patient wants a "close" or "early" appointment, YOU MUST suggest two specific times (e.g., "I can fit you in tomorrow at 10:00 AM or 11:30 AM. Which works better?").
4. **Natural Flow:** Talk like a friendly human, not a form. Keep messages under 2-3 short sentences.

**BOOKING RULES (STRICT):**
- Today's date is ${new Date().toISOString().split('T')[0]}.
- When calling the \`bookAppointment\` tool, the \`date\` parameter MUST be strictly in YYYY-MM-DD format (e.g. 2026-05-19).
- The \`time\` parameter MUST be strictly in 24-hour HH:MM format (e.g. 12:30 or 14:00).
- If the tool returns an ERROR, gracefully apologize to the user and say we will call them to manually confirm. Do NOT say "technical difficulties".
`;

const tools = [
  {
    type: "function",
    function: {
      name: "bookAppointment",
      description: "Book a medical appointment for a patient in the clinic calendar and save it to the records.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date of the appointment in YYYY-MM-DD format" },
          time: { type: "string", description: "Time of the appointment in HH:MM format (24-hour)" },
          reason: { type: "string", description: "Reason for the visit or symptoms" }
        },
        required: ["date", "time", "reason"]
      }
    }
  }
];

export async function processIncomingMessage(patientIdentifier: string, messageBody: string): Promise<string> {
  try {
    // 1. Get or create patient (Using Telegram ID or unique identifier)
    let patient = await dbGet('SELECT * FROM patients WHERE phone_number = ?', [patientIdentifier]) as any;
    if (!patient) {
      await dbRun('INSERT INTO patients (phone_number) VALUES (?)', [patientIdentifier]);
      patient = await dbGet('SELECT * FROM patients WHERE phone_number = ?', [patientIdentifier]) as any;
    }

    console.log('1. Got patient');
    await dbRun('INSERT INTO messages (patient_id, role, content) VALUES (?, ?, ?)', [patient.id, 'user', messageBody]);
    console.log('2. Saved message');

    const historyRows = await dbAll('SELECT role, content FROM messages WHERE patient_id = ? ORDER BY created_at DESC LIMIT 10', [patient.id]) as any[];
    console.log('3. Fetched history');

    // Build history for Groq
    const formattedHistory = historyRows.reverse().map((msg: any) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }));

    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...formattedHistory,
      { role: "user", content: messageBody }
    ];

    console.log('4. Sending message to Groq');
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      tools,
      tool_choice: "auto"
    });

    const firstMessage = response.choices[0].message;
    let aiMessage = "";

    if (firstMessage.tool_calls && firstMessage.tool_calls.length > 0) {
      const toolCall = firstMessage.tool_calls[0];
      if (toolCall.function.name === "bookAppointment") {
        const args = JSON.parse(toolCall.function.arguments);
        const patientName = `Telegram User (${patientIdentifier})`;

        const bookingResult = await createAppointment(
          patientName,
          patientIdentifier,
          args.date,
          args.time,
          args.reason
        );

        await appendToSheet(
          patientName,
          patientIdentifier,
          args.date,
          args.time,
          args.reason
        );

        // Append tool call and result, then request final answer
        messages.push(firstMessage);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ result: bookingResult + " Also successfully logged to Google Sheets." })
        });

        const finalResponse = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages
        });
        aiMessage = finalResponse.choices[0].message.content || "I've booked your appointment.";
      }
    } else {
      aiMessage = firstMessage.content || "I'm sorry, I'm having trouble processing that right now.";
    }

    await dbRun('INSERT INTO messages (patient_id, role, content) VALUES (?, ?, ?)', [patient.id, 'assistant', aiMessage]);

    return aiMessage;
  } catch (error: any) {
    console.error('Error processing message:', error);
    return `Technical Error Details: ${error?.message || JSON.stringify(error)}. Please send this to the developer.`;
  }
}
