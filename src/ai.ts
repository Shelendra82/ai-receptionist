import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';
import { dbGet, dbAll, dbRun } from './db';
import { createAppointment } from './calendar';
import { appendToSheet } from './sheets';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `
You are a professional medical AI receptionist for "HealthCare Clinic". Your goal is to help patients book appointments.

CONVERSATION RULES:
1. Show empathy first if patient mentions pain or illness before asking for details.
2. Never repeat a question the user has already answered.
3. If patient wants a soon appointment, suggest two specific times (e.g., tomorrow at 10:00 AM or 11:30 AM).
4. Keep responses brief - 2 to 3 sentences only.
5. IMPORTANT: Always display time to the patient in 12-hour AM/PM format (e.g. 2:00 PM, 10:30 AM). Never show 24-hour format like 14:00 to the patient.

BOOKING RULES:
- Today's date is ${new Date().toISOString().split('T')[0]}.
- When you have the date, time, and reason confirmed by the patient, call the bookAppointment function.
- The date parameter must be in YYYY-MM-DD format (example: 2026-05-19).
- The time parameter must be in HH:MM 24-hour format (example: 14:00). This is only for the function, not for display.
- If booking fails, apologize and say the staff will call to confirm.
- Never call bookAppointment twice for the same appointment.
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
    // 1. Get or create patient
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

    const formattedHistory = historyRows.reverse().map((msg: any) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }));

    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...formattedHistory
    ];

    console.log('4. Sending message to Groq...');
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      tools,
      tool_choice: "auto"
    });

    const firstMessage = response.choices[0].message;
    let aiMessage = "";

    console.log('5. Groq finish_reason:', response.choices[0].finish_reason);
    console.log('5. Tool calls received:', JSON.stringify(firstMessage.tool_calls, null, 2));
    console.log('5. AI text content:', firstMessage.content);

    if (firstMessage.tool_calls && firstMessage.tool_calls.length > 0) {
      const toolCall = firstMessage.tool_calls[0];
      console.log('6. Tool called:', toolCall.function.name);
      console.log('6. Tool arguments:', toolCall.function.arguments);

      if (toolCall.function.name === "bookAppointment") {
        let args: any;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (parseErr) {
          console.error('7. Failed to parse tool arguments:', toolCall.function.arguments);
          aiMessage = "I'm sorry, I had trouble processing your booking. Could you please repeat the date and time?";
          await dbRun('INSERT INTO messages (patient_id, role, content) VALUES (?, ?, ?)', [patient.id, 'assistant', aiMessage]);
          return aiMessage;
        }
        console.log('7. Booking appointment with args:', args);
        const patientName = `Telegram User (${patientIdentifier})`;

        const bookingResult = await createAppointment(
          patientName,
          patientIdentifier,
          args.date,
          args.time,
          args.reason
        );
        console.log('8. Calendar booking result:', bookingResult);

        await appendToSheet(
          patientName,
          patientIdentifier,
          args.date,
          args.time,
          args.reason
        );
        console.log('9. Sheet updated successfully.');

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
        console.log('10. Final AI message:', aiMessage);
      } else {
        console.warn('Unknown tool called:', toolCall.function.name);
        aiMessage = firstMessage.content || "I'm sorry, I'm having trouble processing that right now.";
      }
    } else {
      aiMessage = firstMessage.content || "I'm sorry, I'm having trouble processing that right now.";
      console.log('5. No tool call — normal text response.');
    }

    await dbRun('INSERT INTO messages (patient_id, role, content) VALUES (?, ?, ?)', [patient.id, 'assistant', aiMessage]);

    return aiMessage;
  } catch (error: any) {
    console.error('Error processing message:', error);
    return `Technical Error Details: ${error?.message || JSON.stringify(error)}. Please send this to the developer.`;
  }
}
