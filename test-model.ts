import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function test() {
    const modelsToTest = ['gemini-1.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];
    for (const m of modelsToTest) {
        try {
            console.log(`Testing ${m}...`);
            const chat = ai.chats.create({ 
                model: m,
                config: {
                    systemInstruction: "You are a helpful AI.",
                    tools: [{
                        functionDeclarations: [{
                            name: 'bookAppointment',
                            description: 'Book a medical appointment',
                            parameters: {
                                type: 'OBJECT',
                                properties: { date: { type: 'STRING' } },
                                required: ['date']
                            }
                        }]
                    }] as any
                }
            });
            const response = await chat.sendMessage({ message: 'Hello!' });
            console.log(`Success with ${m}:`, response.text);
            return; // Stop on first success
        } catch (e: any) {
            console.log(`Failed ${m}:`);
            console.dir(e, { depth: null });
        }
    }
}
test();
