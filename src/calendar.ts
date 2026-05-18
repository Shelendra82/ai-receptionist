import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

let auth: any;
let calendar: any;

try {
  if (process.env.GOOGLE_CREDS_JSON) {
    // ✅ Railway: Use JSON content directly from environment variable
    console.log('Calendar: Using GOOGLE_CREDS_JSON (Railway mode)...');
    const credentials = JSON.parse(process.env.GOOGLE_CREDS_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: SCOPES,
    });
    calendar = google.calendar({ version: 'v3', auth });
    console.log('Google Calendar service initialized (via GOOGLE_CREDS_JSON).');
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // ✅ Local: Use key file path
    console.log('Calendar: Using GOOGLE_APPLICATION_CREDENTIALS (local mode)...');
    auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: SCOPES,
    });
    calendar = google.calendar({ version: 'v3', auth });
    console.log('Google Calendar service initialized (via keyFile).');
  } else {
    console.warn('Google Calendar credentials not found. Booking will be simulated.');
  }
} catch (error) {
  console.error('Error initializing Google Calendar:', error);
}

/**
 * Creates an event in Google Calendar.
 */
export async function createAppointment(
  patientName: string,
  phoneNumber: string,
  date: string, // YYYY-MM-DD
  time: string, // HH:MM (24-hour)
  reason: string
): Promise<string> {
  try {
    if (!calendar || !CALENDAR_ID) {
      return `Simulated booking for ${patientName} on ${date} at ${time}. (Google Calendar not configured)`;
    }

    // Combine date and time in IST timezone (+05:30) so Railway UTC server saves correctly
    const startDateTime = new Date(`${date}T${time}:00+05:30`);

    // Check if the date is invalid
    if (isNaN(startDateTime.getTime())) {
       return `ERROR: Invalid date or time format received. Date must be YYYY-MM-DD and Time must be HH:MM (24-hour). You passed: Date: ${date}, Time: ${time}. Please ask the user to clarify or re-format and try the tool again.`;
    }

    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    const event = {
      summary: `Appointment: ${patientName}`,
      description: `Reason: ${reason}\nPhone: ${phoneNumber}`,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Asia/Kolkata',
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Asia/Kolkata',
      },
    };

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: event,
    });

    return `Appointment successfully booked. Event Link: ${response.data.htmlLink}`;
  } catch (error: any) {
    console.error('Error creating calendar event:', error?.message);
    return `ERROR: Failed to book appointment in Google Calendar. Google API says: ${error?.message || "Unknown error"}. Tell the patient that their request is noted and our staff will call them shortly to confirm the exact time.`;
  }
}

/**
 * Lists available slots or simply checks if a time is in the future.
 */
export async function checkAvailability(date: string, time: string): Promise<boolean> {
  const requestedDateTime = new Date(`${date}T${time}:00+05:30`);
  if (requestedDateTime > new Date()) {
    return true;
  }
  return false;
}
