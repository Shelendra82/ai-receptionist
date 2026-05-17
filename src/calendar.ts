import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

// We expect a service account JSON file path to be defined in the environment,
// or the credentials can be loaded directly if set in environment variables.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

let auth: any;
let calendar: any;

try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: SCOPES,
    });
    calendar = google.calendar({ version: 'v3', auth });
    console.log('Google Calendar service initialized.');
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

    // Combine date and time into a single Date object
    const startDateTime = new Date(`${date}T${time}:00`);
    // Assuming 1-hour appointments
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    const event = {
      summary: `Appointment: ${patientName}`,
      description: `Reason: ${reason}\nPhone: ${phoneNumber}`,
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'America/New_York', // Change this to the clinic's timezone
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'America/New_York',
      },
    };

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: event,
    });

    return `Appointment successfully booked. Event Link: ${response.data.htmlLink}`;
  } catch (error) {
    console.error('Error creating calendar event:', error);
    throw new Error('Failed to book appointment in Google Calendar.');
  }
}

/**
 * Lists available slots or simply checks if a time is in the future.
 * For MVP, we will just simulate checking availability.
 */
export async function checkAvailability(date: string, time: string): Promise<boolean> {
  // In a full implementation, you would use calendar.events.list to find conflicts.
  // For now, we assume all future times are available.
  const requestedDateTime = new Date(`${date}T${time}:00`);
  if (requestedDateTime > new Date()) {
    return true;
  }
  return false;
}
